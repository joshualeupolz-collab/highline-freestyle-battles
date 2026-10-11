/**
 * Minimal WebM (Matroska/EBML) reader and writer for cutting without re-encoding.
 *
 * Chrome's MediaRecorder writes "live" WebM: unknown segment/cluster sizes, no duration and no
 * cues, so the raw file cannot be seeked. The writer produces a complete file with duration,
 * cues and one cluster per video keyframe. Frames are copied unchanged.
 */
import { TrimError, Writer } from './bytes';
import type { TrimResult, VideoInfo } from './types';

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
} as const;

/** Elements directly inside the segment; they also end a cluster of unknown size. */
const LEVEL1 = new Set<number>([
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cluster,
  ID.Cues,
  0x1254c367, // Tags
  0x1043a770, // Chapters
  0x1941a469, // Attachments
]);

interface Element {
  id: number;
  start: number;
  body: number;
  /** End of the element; for unknown sizes the end of the available data. */
  end: number;
  unknownSize: boolean;
}

/** Reads a variable-length integer. With `keepMarker` (element IDs) the length bit stays set. */
function vint(
  d: Uint8Array,
  o: number,
  keepMarker: boolean,
): { value: number; length: number; allOnes: boolean } | undefined {
  const first = d[o];
  if (first === undefined || first === 0) return undefined;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (o + length > d.length) return undefined;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    const b = d[o + i] as number;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, allOnes };
}

function header(d: Uint8Array, o: number, limit: number): Element | undefined {
  const id = vint(d, o, true);
  if (!id) return undefined;
  const size = vint(d, o + id.length, false);
  if (!size) return undefined;
  const body = o + id.length + size.length;
  if (body > limit) return undefined;
  if (size.allOnes) return { id: id.value, start: o, body, end: limit, unknownSize: true };
  return { id: id.value, start: o, body, end: body + size.value, unknownSize: false };
}

function readUint(d: Uint8Array, e: Element): number {
  let v = 0;
  for (let i = e.body; i < e.end; i++) v = v * 256 + (d[i] as number);
  return v;
}

function readText(d: Uint8Array, e: Element): string {
  let s = '';
  for (let i = e.body; i < e.end; i++) s += String.fromCharCode(d[i] as number);
  return s;
}

/** Complete child elements of a known-size master element. */
function children(d: Uint8Array, e: Element): Element[] {
  const out: Element[] = [];
  let o = e.body;
  const limit = Math.min(e.end, d.length);
  while (o < limit) {
    const c = header(d, o, limit);
    if (!c || c.unknownSize || c.end > limit) break;
    out.push(c);
    o = c.end;
  }
  return out;
}

interface WebmTrack {
  number: number;
  kind: 'video' | 'audio' | 'other';
  codec: string;
  width?: number;
  height?: number;
}

interface Frame {
  track: number;
  /** Absolute time in timecode ticks. */
  time: number;
  key: boolean;
  /** Block bytes after the track number and timecode (flags + payload). */
  payload: Uint8Array;
  /** Track number as written (variable-length integer). */
  trackBytes: Uint8Array;
}

interface WebmFile {
  ebmlHeader: Uint8Array;
  tracksRaw: Uint8Array;
  timecodeScale: number;
  tracks: WebmTrack[];
  frames: Frame[];
  truncated: boolean;
}

export function isWebm(d: Uint8Array): boolean {
  return d[0] === 0x1a && d[1] === 0x45 && d[2] === 0xdf && d[3] === 0xa3;
}

export function parseWebm(d: Uint8Array): WebmFile {
  const ebml = header(d, 0, d.length);
  if (!ebml || ebml.id !== ID.EBML || ebml.end > d.length) throw new TrimError('Not a WebM file');
  const segment = header(d, ebml.end, d.length);
  if (!segment || segment.id !== ID.Segment) throw new TrimError('WebM without segment');

  const file: WebmFile = {
    ebmlHeader: d.slice(ebml.start, ebml.end),
    tracksRaw: new Uint8Array(0),
    timecodeScale: 1_000_000,
    tracks: [],
    frames: [],
    truncated: false,
  };

  const limit = Math.min(segment.end, d.length);
  let o = segment.body;
  while (o < limit) {
    const e = header(d, o, limit);
    if (!e) {
      file.truncated = true;
      break;
    }
    if (e.id === ID.Cluster) {
      o = parseCluster(d, e, limit, file);
      continue;
    }
    if (e.unknownSize || e.end > limit) {
      file.truncated = true;
      break;
    }
    if (e.id === ID.Info) {
      const scale = children(d, e).find((c) => c.id === ID.TimecodeScale);
      if (scale) file.timecodeScale = readUint(d, scale);
    } else if (e.id === ID.Tracks) {
      file.tracksRaw = d.slice(e.start, e.end);
      file.tracks = children(d, e)
        .filter((c) => c.id === ID.TrackEntry)
        .map((entry) => parseTrackEntry(d, entry));
    }
    o = e.end;
  }
  if (file.tracks.length === 0) throw new TrimError('WebM without tracks');
  return file;
}

function parseTrackEntry(d: Uint8Array, entry: Element): WebmTrack {
  const track: WebmTrack = { number: 0, kind: 'other', codec: '' };
  for (const c of children(d, entry)) {
    if (c.id === ID.TrackNumber) track.number = readUint(d, c);
    else if (c.id === ID.TrackType) {
      const type = readUint(d, c);
      track.kind = type === 1 ? 'video' : type === 2 ? 'audio' : 'other';
    } else if (c.id === ID.CodecID) track.codec = readText(d, c);
    else if (c.id === ID.Video) {
      for (const v of children(d, c)) {
        if (v.id === ID.PixelWidth) track.width = readUint(d, v);
        if (v.id === ID.PixelHeight) track.height = readUint(d, v);
      }
    }
  }
  return track;
}

/** Reads the frames of one cluster; returns where the next element starts. */
function parseCluster(d: Uint8Array, cluster: Element, segmentEnd: number, file: WebmFile): number {
  const limit = Math.min(cluster.end, segmentEnd);
  let clusterTime = 0;
  let o = cluster.body;
  while (o < limit) {
    const e = header(d, o, limit);
    if (!e) {
      file.truncated = true;
      return limit;
    }
    if (cluster.unknownSize && LEVEL1.has(e.id)) return o;
    if (e.unknownSize || e.end > limit) {
      file.truncated = true;
      return limit;
    }
    if (e.id === ID.Timecode) clusterTime = readUint(d, e);
    else if (e.id === ID.SimpleBlock) {
      const frame = readBlock(d, e, clusterTime);
      if (frame) {
        frame.key = ((frame.payload[0] ?? 0) & 0x80) !== 0;
        file.frames.push(frame);
      }
    } else if (e.id === ID.BlockGroup) {
      const parts = children(d, e);
      const block = parts.find((c) => c.id === ID.Block);
      const frame = block && readBlock(d, block, clusterTime);
      if (frame) {
        frame.key = !parts.some((c) => c.id === ID.ReferenceBlock);
        // Becomes a SimpleBlock on output: set the keyframe flag accordingly.
        frame.payload[0] = ((frame.payload[0] ?? 0) & 0x7e) | (frame.key ? 0x80 : 0);
        file.frames.push(frame);
      }
    }
    o = e.end;
  }
  return limit;
}

function readBlock(d: Uint8Array, e: Element, clusterTime: number): Frame | undefined {
  const track = vint(d, e.body, false);
  if (!track) return undefined;
  const t = e.body + track.length;
  const relative = ((((d[t] ?? 0) << 8) | (d[t + 1] ?? 0)) << 16) >> 16; // signed 16 bit
  return {
    track: track.value,
    time: clusterTime + relative,
    key: false,
    payload: d.slice(t + 2, e.end),
    trackBytes: d.slice(e.body, t),
  };
}

// ---------------------------------------------------------------------------------------------
// Analysis and trimming

function toSeconds(file: WebmFile, ticks: number): number {
  return (ticks * file.timecodeScale) / 1e9;
}

/** End of the last frame of each track: last time + the gap between its last two frames. */
function endTicks(frames: Frame[]): number {
  let end = 0;
  const last = new Map<number, number>();
  const gap = new Map<number, number>();
  for (const f of frames) {
    const prev = last.get(f.track);
    if (prev !== undefined && f.time > prev) gap.set(f.track, f.time - prev);
    last.set(f.track, Math.max(prev ?? f.time, f.time));
  }
  for (const [track, time] of last) end = Math.max(end, time + (gap.get(track) ?? 0));
  return end;
}

function describe(file: WebmFile): VideoInfo {
  const origin = Math.min(...file.frames.map((f) => f.time));
  const video = file.tracks.find((t) => t.kind === 'video');
  return {
    container: 'webm',
    mimeType: 'video/webm',
    duration: file.frames.length ? toSeconds(file, endTicks(file.frames) - origin) : 0,
    keyframes: video
      ? file.frames
          .filter((f) => f.track === video.number && f.key)
          .map((f) => toSeconds(file, f.time - origin))
      : [],
    tracks: file.tracks.map((t) => ({
      kind: t.kind,
      codec: t.codec,
      samples: file.frames.filter((f) => f.track === t.number).length,
      width: t.width,
      height: t.height,
    })),
    truncated: file.truncated,
  };
}

export function analyzeWebm(d: Uint8Array): VideoInfo {
  return describe(parseWebm(d));
}

/** Cuts [start, end) (seconds from the beginning), starting at the keyframe at or before `start`. */
export function trimWebm(d: Uint8Array, start: number, end: number): TrimResult {
  const file = parseWebm(d);
  if (file.frames.length === 0) throw new TrimError('The recording contains no frames');
  const ticksPerSecond = 1e9 / file.timecodeScale;
  const origin = Math.min(...file.frames.map((f) => f.time));
  const video = file.tracks.find((t) => t.kind === 'video');

  let first = -1;
  file.frames.forEach((f, i) => {
    if (
      video &&
      f.track === video.number &&
      f.key &&
      f.time - origin <= start * ticksPerSecond + 1e-6
    )
      first = i;
  });
  if (video && first < 0) first = file.frames.findIndex((f) => f.track === video.number);
  const cut = video
    ? (file.frames[first] as Frame).time
    : origin + Math.round(start * ticksPerSecond);
  const stop = origin + end * ticksPerSecond;

  const chosen = file.frames.filter((f, i) => {
    if (f.time >= stop) return false;
    if (video && f.track === video.number) return i >= first;
    return f.time >= cut;
  });

  const bytes = writeWebm(file, chosen, cut, video?.number);
  const out = parseWebm(bytes);
  const info = describe(out);
  const actualStart = toSeconds(file, cut - origin);
  return {
    bytes,
    mimeType: 'video/webm',
    start: actualStart,
    end: actualStart + info.duration,
    info,
  };
}

// ---------------------------------------------------------------------------------------------
// Writing

function writeId(w: Writer, id: number): void {
  if (id >= 0x1000000) w.u32(id);
  else if (id >= 0x10000) w.u8(id >>> 16).u16(id & 0xffff);
  else if (id >= 0x100) w.u16(id);
  else w.u8(id);
}

function writeSize(w: Writer, size: number): void {
  let length = 1;
  while (size >= 2 ** (7 * length) - 1) length++;
  const bytes: number[] = [];
  let v = size;
  for (let i = 0; i < length; i++) {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  }
  bytes[0] = (bytes[0] as number) | (0x80 >> (length - 1));
  for (const b of bytes) w.u8(b);
}

function element(w: Writer, id: number, body: Uint8Array): void {
  writeId(w, id);
  writeSize(w, body.length);
  w.bytes(body);
}

function build(fill: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  fill(w);
  return w.result();
}

/** Unsigned integer element with a fixed 8-byte value, so sizes are known before positions. */
function uint8(w: Writer, id: number, value: number): void {
  writeId(w, id);
  w.u8(0x88);
  w.u64(value);
}

function writeWebm(
  file: WebmFile,
  frames: Frame[],
  cut: number,
  videoTrack: number | undefined,
): Uint8Array {
  // Clusters: a new one at every video keyframe (= seek point) and before the 16-bit offset overflows.
  const clusters: { time: number; bytes: Uint8Array; key: boolean }[] = [];
  let current: { time: number; frames: Frame[]; key: boolean } | undefined;
  const flush = () => {
    if (!current) return;
    const { time, frames: list, key } = current;
    const body = build((w) => {
      uint8(w, ID.Timecode, time);
      for (const f of list) {
        const relative = f.time - cut - time;
        element(
          w,
          ID.SimpleBlock,
          build((b) =>
            b
              .bytes(f.trackBytes)
              .u16(relative & 0xffff)
              .bytes(f.payload),
          ),
        );
      }
    });
    clusters.push({ time, bytes: build((w) => element(w, ID.Cluster, body)), key });
  };
  for (const f of frames) {
    const t = f.time - cut;
    const isKey = videoTrack !== undefined && f.track === videoTrack && f.key;
    const startsCluster =
      !current ||
      isKey ||
      t - current.time > 30_000 ||
      (videoTrack === undefined && t - current.time > 5_000);
    if (startsCluster) {
      flush();
      current = { time: t, frames: [], key: isKey };
    }
    current?.frames.push(f);
  }
  flush();

  const duration = endTicks(frames) - cut;
  const info = build((w) =>
    element(
      w,
      ID.Info,
      build((b) => {
        uint8(b, ID.TimecodeScale, file.timecodeScale);
        element(b, ID.MuxingApp, new TextEncoder().encode('hfb'));
        element(b, ID.WritingApp, new TextEncoder().encode('hfb'));
        writeId(b, ID.Duration);
        b.u8(0x88).f64(duration);
      }),
    ),
  );

  const cuePoints = clusters.filter((c) => c.key);
  const cuesFor = (positions: number[]) =>
    build((w) =>
      element(
        w,
        ID.Cues,
        build((b) => {
          cuePoints.forEach((c, i) => {
            element(
              b,
              ID.CuePoint,
              build((p) => {
                uint8(p, ID.CueTime, c.time);
                element(
                  p,
                  ID.CueTrackPositions,
                  build((t) => {
                    uint8(t, ID.CueTrack, videoTrack ?? 1);
                    uint8(t, ID.CueClusterPosition, positions[i] ?? 0);
                  }),
                );
              }),
            );
          });
        }),
      ),
    );
  const seekHeadFor = (infoPos: number, tracksPos: number, cuesPos: number) =>
    build((w) =>
      element(
        w,
        ID.SeekHead,
        build((b) => {
          for (const [id, pos] of [
            [ID.Info, infoPos],
            [ID.Tracks, tracksPos],
            [ID.Cues, cuesPos],
          ] as const) {
            element(
              b,
              ID.Seek,
              build((s) => {
                element(
                  s,
                  ID.SeekID,
                  build((x) => writeId(x, id)),
                );
                uint8(s, ID.SeekPosition, pos);
              }),
            );
          }
        }),
      ),
    );

  // All position fields have a fixed width, so sizes can be computed with placeholders first.
  const seekHeadSize = seekHeadFor(0, 0, 0).length;
  const infoPos = seekHeadSize;
  const tracksPos = infoPos + info.length;
  const cuesPos = tracksPos + file.tracksRaw.length;
  const cuesSize = cuesFor([]).length;
  let position = cuesPos + cuesSize;
  const clusterPositions = new Map<(typeof clusters)[number], number>();
  for (const c of clusters) {
    clusterPositions.set(c, position);
    position += c.bytes.length;
  }
  const cues = cuesFor(cuePoints.map((c) => clusterPositions.get(c) ?? 0));
  const segmentBody = new Writer();
  segmentBody
    .bytes(seekHeadFor(infoPos, tracksPos, cuesPos))
    .bytes(info)
    .bytes(file.tracksRaw)
    .bytes(cues);
  for (const c of clusters) segmentBody.bytes(c.bytes);

  const out = new Writer();
  out.bytes(file.ebmlHeader);
  element(out, ID.Segment, segmentBody.result());
  return out.result();
}
