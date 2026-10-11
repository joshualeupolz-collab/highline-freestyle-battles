/**
 * Minimal MP4 (ISO BMFF) reader and writer for cutting without re-encoding.
 *
 * Reads both layouts browsers produce: fragmented MP4 (MediaRecorder in Safari and Chrome:
 * moov without samples, then moof+mdat pairs) and classic MP4 (sample tables in moov).
 * Writes a classic MP4 with the moov in front, which every player and ffmpeg understand.
 * Codec data (the sample description, `stsd`) is copied unchanged, so any codec works.
 */
import { readI32, readType, readU16, readU32, readU64, TrimError, Writer } from './bytes';
import type { TrimResult, VideoInfo } from './types';

interface Box {
  type: string;
  start: number;
  /** Start of the payload. */
  body: number;
  end: number;
}

interface Sample {
  /** Byte offset in the source file. */
  offset: number;
  size: number;
  /** Decode time in track timescale units. */
  dts: number;
  duration: number;
  /** Composition time offset (B-frames); presentation time = dts + cto. */
  cto: number;
  sync: boolean;
}

interface Track {
  id: number;
  kind: 'video' | 'audio' | 'other';
  timescale: number;
  /** Media time shown at movie time 0 (from the source edit list), in track units. */
  shift: number;
  language: number;
  codec: string;
  width?: number;
  height?: number;
  // Copied unchanged into the output.
  hdlr: Uint8Array;
  mediaHeader: Uint8Array | undefined;
  stsd: Uint8Array;
  tkhd: {
    volume: number;
    layer: number;
    altGroup: number;
    matrix: Uint8Array;
    w: number;
    h: number;
  };
  trex: { duration: number; size: number; flags: number };
  samples: Sample[];
}

interface Movie {
  tracks: Track[];
  truncated: boolean;
}

/** Child boxes in [from, to). Stops (and reports it) at a box that runs past the end of the data. */
function children(d: Uint8Array, from: number, to: number): { boxes: Box[]; truncated: boolean } {
  const boxes: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = readU32(d, o);
    const type = readType(d, o + 4);
    let body = o + 8;
    if (size === 1) {
      if (o + 16 > to) return { boxes, truncated: true };
      size = readU64(d, o + 8);
      body = o + 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < body - o) throw new TrimError(`Invalid MP4 box size at ${o}`);
    if (o + size > to) {
      // A partly written mdat still holds usable samples; anything else is cut off.
      if (type === 'mdat') boxes.push({ type, start: o, body, end: to });
      return { boxes, truncated: true };
    }
    boxes.push({ type, start: o, body, end: o + size });
    o += size;
  }
  return { boxes, truncated: o < to };
}

function find(d: Uint8Array, parent: Box | undefined, type: string): Box | undefined {
  if (!parent) return undefined;
  return children(d, parent.body, parent.end).boxes.find((b) => b.type === type);
}

function raw(d: Uint8Array, box: Box | undefined): Uint8Array | undefined {
  return box ? d.slice(box.start, box.end) : undefined;
}

export function isMp4(d: Uint8Array): boolean {
  return readType(d, 4) === 'ftyp';
}

export function parseMp4(d: Uint8Array): Movie {
  const top = children(d, 0, d.length);
  const moov = top.boxes.find((b) => b.type === 'moov');
  if (!moov) throw new TrimError('MP4 without moov box');
  const mvhd = find(d, moov, 'mvhd');
  if (!mvhd) throw new TrimError('MP4 without mvhd box');
  const movieTimescale = readU32(d, mvhd.body + ((d[mvhd.body] ?? 0) === 1 ? 20 : 12));

  const trexById = new Map<number, Track['trex']>();
  const mvex = find(d, moov, 'mvex');
  if (mvex) {
    for (const b of children(d, mvex.body, mvex.end).boxes) {
      if (b.type !== 'trex') continue;
      trexById.set(readU32(d, b.body + 4), {
        duration: readU32(d, b.body + 12),
        size: readU32(d, b.body + 16),
        flags: readU32(d, b.body + 20),
      });
    }
  }

  const tracks: Track[] = [];
  for (const trak of children(d, moov.body, moov.end).boxes) {
    if (trak.type !== 'trak') continue;
    tracks.push(parseTrak(d, trak, movieTimescale, trexById));
  }

  const byId = new Map(tracks.map((t) => [t.id, t]));
  for (const moof of top.boxes) {
    if (moof.type === 'moof') parseMoof(d, moof, byId);
  }
  // Drop samples whose bytes are missing (file cut off in the middle of an mdat).
  for (const t of tracks) {
    const complete = t.samples.findIndex((s) => s.offset + s.size > d.length);
    if (complete >= 0) t.samples.length = complete;
  }
  return { tracks, truncated: top.truncated };
}

function parseTrak(
  d: Uint8Array,
  trak: Box,
  movieTimescale: number,
  trexById: Map<number, Track['trex']>,
): Track {
  const tkhd = find(d, trak, 'tkhd');
  const mdia = find(d, trak, 'mdia');
  const mdhd = find(d, mdia, 'mdhd');
  const hdlr = find(d, mdia, 'hdlr');
  const minf = find(d, mdia, 'minf');
  const stbl = find(d, minf, 'stbl');
  const stsd = find(d, stbl, 'stsd');
  if (!tkhd || !mdhd || !hdlr || !minf || !stbl || !stsd)
    throw new TrimError('Incomplete MP4 track');

  const tv = d[tkhd.body] ?? 0;
  const id = readU32(d, tkhd.body + (tv === 1 ? 20 : 12));
  const after = tkhd.body + (tv === 1 ? 36 : 24); // after duration
  const tkhdInfo = {
    layer: readU16(d, after + 8),
    altGroup: readU16(d, after + 10),
    volume: readU16(d, after + 12),
    matrix: d.slice(after + 16, after + 52),
    w: readU32(d, after + 52),
    h: readU32(d, after + 56),
  };

  const mv = d[mdhd.body] ?? 0;
  const timescale = readU32(d, mdhd.body + (mv === 1 ? 20 : 12));
  const language = readU16(d, mdhd.body + (mv === 1 ? 32 : 20));
  const handler = readType(d, hdlr.body + 8);
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';

  const entry = stsd.body + 8;
  const codec = readType(d, entry + 4);
  const visual =
    kind === 'video' ? { width: readU16(d, entry + 32), height: readU16(d, entry + 34) } : {};

  const mediaHeader = children(d, minf.body, minf.end).boxes.find((b) =>
    ['vmhd', 'smhd', 'nmhd', 'sthd'].includes(b.type),
  );

  return {
    id,
    kind,
    timescale,
    shift: editShift(d, find(d, trak, 'edts'), timescale, movieTimescale),
    language,
    codec,
    ...visual,
    hdlr: d.slice(hdlr.start, hdlr.end),
    mediaHeader: raw(d, mediaHeader),
    stsd: d.slice(stsd.start, stsd.end),
    tkhd: tkhdInfo,
    trex: trexById.get(id) ?? { duration: 0, size: 0, flags: 0 },
    samples: sampleTable(d, stbl),
  };
}

/** Reads the edit list as one shift: media time that is shown at movie time 0. */
function editShift(
  d: Uint8Array,
  edts: Box | undefined,
  timescale: number,
  movieTs: number,
): number {
  const elst = find(d, edts, 'elst');
  if (!elst) return 0;
  const v = d[elst.body] ?? 0;
  const count = readU32(d, elst.body + 4);
  let empty = 0;
  let o = elst.body + 8;
  for (let i = 0; i < count; i++) {
    const segment = v === 1 ? readU64(d, o) : readU32(d, o);
    const mediaTime = v === 1 ? readI32(d, o + 12) : readI32(d, o + 4); // high word of i64 ignored
    o += v === 1 ? 20 : 12;
    if (mediaTime === -1) {
      empty += segment;
      continue;
    }
    return mediaTime - Math.round((empty * timescale) / movieTs);
  }
  return 0;
}

/** Sample table of a classic MP4 (empty for fragmented files). */
function sampleTable(d: Uint8Array, stbl: Box): Sample[] {
  const stsz = find(d, stbl, 'stsz');
  const stts = find(d, stbl, 'stts');
  const stsc = find(d, stbl, 'stsc');
  const chunkBox = find(d, stbl, 'stco') ?? find(d, stbl, 'co64');
  if (!stsz || !stts || !stsc || !chunkBox) return [];
  const count = readU32(d, stsz.body + 8);
  if (count === 0) return [];
  const fixedSize = readU32(d, stsz.body + 4);

  const samples: Sample[] = [];
  let dts = 0;
  let o = stts.body + 8;
  for (let e = readU32(d, stts.body + 4); e > 0; e--, o += 8) {
    const n = readU32(d, o);
    const delta = readU32(d, o + 4);
    for (let i = 0; i < n && samples.length < count; i++) {
      const size = fixedSize || readU32(d, stsz.body + 12 + samples.length * 4);
      samples.push({ offset: 0, size, dts, duration: delta, cto: 0, sync: true });
      dts += delta;
    }
  }

  const ctts = find(d, stbl, 'ctts');
  if (ctts) {
    const signed = (d[ctts.body] ?? 0) === 1;
    let i = 0;
    o = ctts.body + 8;
    for (let e = readU32(d, ctts.body + 4); e > 0; e--, o += 8) {
      const n = readU32(d, o);
      const offset = signed ? readI32(d, o + 4) : readU32(d, o + 4);
      for (let k = 0; k < n && i < samples.length; k++) (samples[i++] as Sample).cto = offset;
    }
  }

  const stss = find(d, stbl, 'stss');
  if (stss) {
    for (const s of samples) s.sync = false;
    for (let e = 0, n = readU32(d, stss.body + 4); e < n; e++) {
      const s = samples[readU32(d, stss.body + 8 + e * 4) - 1];
      if (s) s.sync = true;
    }
  }

  const large = chunkBox.type === 'co64';
  const chunkCount = readU32(d, chunkBox.body + 4);
  const chunkOffset = (c: number) =>
    large ? readU64(d, chunkBox.body + 8 + c * 8) : readU32(d, chunkBox.body + 8 + c * 4);
  const entries = readU32(d, stsc.body + 4);
  let i = 0;
  for (let e = 0; e < entries; e++) {
    const firstChunk = readU32(d, stsc.body + 8 + e * 12) - 1;
    const perChunk = readU32(d, stsc.body + 12 + e * 12);
    const lastChunk = e + 1 < entries ? readU32(d, stsc.body + 8 + (e + 1) * 12) - 1 : chunkCount;
    for (let c = firstChunk; c < lastChunk && i < samples.length; c++) {
      let offset = chunkOffset(c);
      for (let k = 0; k < perChunk && i < samples.length; k++) {
        const s = samples[i++] as Sample;
        s.offset = offset;
        offset += s.size;
      }
    }
  }
  return samples;
}

const NON_SYNC = 0x10000;

function parseMoof(d: Uint8Array, moof: Box, tracks: Map<number, Track>): void {
  for (const traf of children(d, moof.body, moof.end).boxes) {
    if (traf.type !== 'traf') continue;
    const tfhd = find(d, traf, 'tfhd');
    if (!tfhd) continue;
    const flags = readU32(d, tfhd.body) & 0xffffff;
    const track = tracks.get(readU32(d, tfhd.body + 4));
    if (!track) continue;
    let o = tfhd.body + 8;
    let base = moof.start;
    if (flags & 0x1) {
      base = readU64(d, o);
      o += 8;
    }
    if (flags & 0x2) o += 4;
    let defDuration = track.trex.duration;
    let defSize = track.trex.size;
    let defFlags = track.trex.flags;
    if (flags & 0x8) {
      defDuration = readU32(d, o);
      o += 4;
    }
    if (flags & 0x10) {
      defSize = readU32(d, o);
      o += 4;
    }
    if (flags & 0x20) defFlags = readU32(d, o);

    const last = track.samples[track.samples.length - 1];
    let dts = last ? last.dts + last.duration : 0;
    const tfdt = find(d, traf, 'tfdt');
    if (tfdt)
      dts = (d[tfdt.body] ?? 0) === 1 ? readU64(d, tfdt.body + 4) : readU32(d, tfdt.body + 4);

    let dataOffset = base;
    for (const trun of children(d, traf.body, traf.end).boxes) {
      if (trun.type !== 'trun') continue;
      const version = d[trun.body] ?? 0;
      const tf = readU32(d, trun.body) & 0xffffff;
      const count = readU32(d, trun.body + 4);
      let p = trun.body + 8;
      if (tf & 0x1) {
        dataOffset = base + readI32(d, p);
        p += 4;
      }
      let firstFlags: number | undefined;
      if (tf & 0x4) {
        firstFlags = readU32(d, p);
        p += 4;
      }
      for (let i = 0; i < count; i++) {
        let duration = defDuration;
        let size = defSize;
        let sampleFlags = i === 0 && firstFlags !== undefined ? firstFlags : defFlags;
        let cto = 0;
        if (tf & 0x100) {
          duration = readU32(d, p);
          p += 4;
        }
        if (tf & 0x200) {
          size = readU32(d, p);
          p += 4;
        }
        if (tf & 0x400) {
          sampleFlags = readU32(d, p);
          p += 4;
        }
        if (tf & 0x800) {
          cto = version === 1 ? readI32(d, p) : readU32(d, p);
          p += 4;
        }
        track.samples.push({
          offset: dataOffset,
          size,
          dts,
          duration,
          cto,
          sync: track.kind !== 'video' || !(sampleFlags & NON_SYNC),
        });
        dataOffset += size;
        dts += duration;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Analysis and trimming

/** Presentation time of a sample in seconds, relative to the movie start. */
function seconds(t: Track, value: number): number {
  return (value - t.shift) / t.timescale;
}

function trackEnd(t: Track): number {
  let end = 0;
  for (const s of t.samples) end = Math.max(end, seconds(t, s.dts + s.cto + s.duration));
  return end;
}

function trackStart(t: Track): number {
  let start = Number.POSITIVE_INFINITY;
  for (const s of t.samples) start = Math.min(start, seconds(t, s.dts + s.cto));
  return Number.isFinite(start) ? start : 0;
}

function describe(movie: Movie): VideoInfo {
  const tracks = movie.tracks.filter((t) => t.samples.length > 0);
  const start = Math.min(...tracks.map(trackStart));
  const end = Math.max(...tracks.map(trackEnd));
  const video = tracks.find((t) => t.kind === 'video');
  return {
    container: 'mp4',
    mimeType: 'video/mp4',
    duration: tracks.length ? end - start : 0,
    keyframes: video
      ? video.samples.filter((s) => s.sync).map((s) => seconds(video, s.dts + s.cto) - start)
      : [],
    tracks: movie.tracks.map((t) => ({
      kind: t.kind,
      codec: t.codec,
      samples: t.samples.length,
      width: t.width,
      height: t.height,
    })),
    truncated: movie.truncated,
  };
}

export function analyzeMp4(d: Uint8Array): VideoInfo {
  return describe(parseMp4(d));
}

/**
 * Cuts [start, end) (seconds from the beginning) without re-encoding. The video starts at the
 * last keyframe at or before `start`, so the result can begin up to one keyframe interval early.
 */
export function trimMp4(d: Uint8Array, start: number, end: number): TrimResult {
  const movie = parseMp4(d);
  const tracks = movie.tracks.filter((t) => t.samples.length > 0);
  if (tracks.length === 0) throw new TrimError('The recording contains no frames');
  const origin = Math.min(...tracks.map(trackStart));
  const video = tracks.find((t) => t.kind === 'video');

  // Cut start = presentation time of the keyframe; all tracks are aligned to it.
  let first = 0;
  if (video) {
    video.samples.forEach((s, i) => {
      if (s.sync && seconds(video, s.dts + s.cto) - origin <= start + 1e-6) first = i;
    });
  }
  const cut = video
    ? seconds(video, (video.samples[first] as Sample).dts + (video.samples[first] as Sample).cto)
    : origin + start;
  const stop = origin + end;

  const parts: { track: Track; samples: Sample[] }[] = [];
  for (const t of tracks) {
    // Decode order is kept, so every chosen frame still has the frames it references.
    const samples =
      t === video
        ? t.samples.slice(first).filter((s) => seconds(t, s.dts) < stop || s === t.samples[first])
        : t.samples.filter((s) => {
            const at = seconds(t, s.dts + s.cto);
            return at + s.duration / t.timescale > cut + 1e-6 && at < stop;
          });
    if (samples.length) parts.push({ track: t, samples });
  }

  const bytes = writeMp4(d, parts, cut);
  const out = parseMp4(bytes);
  const info = describe(out);
  return {
    bytes,
    mimeType: 'video/mp4',
    start: cut - origin,
    end: cut - origin + info.duration,
    info,
  };
}

// ---------------------------------------------------------------------------------------------
// Writing a classic MP4

const MOVIE_TIMESCALE = 1000;

function box(w: Writer, type: string, fill: () => void): void {
  const at = w.length;
  w.u32(0).ascii(type);
  fill();
  w.patchU32(at, w.length - at);
}

function fullBox(w: Writer, type: string, version: number, flags: number, fill: () => void): void {
  box(w, type, () => {
    w.u32(((version & 0xff) << 24) | (flags & 0xffffff));
    fill();
  });
}

interface Planned {
  track: Track;
  samples: Sample[];
  /** First sample's dts; written decode times start at 0. */
  base: number;
  /** Media time (track units) shown at the cut, or negative = silence/blank before the track. */
  mediaStart: number;
  /** Track duration in track units (from the first decode time). */
  mediaDuration: number;
}

function writeMp4(
  d: Uint8Array,
  parts: { track: Track; samples: Sample[] }[],
  cut: number,
): Uint8Array {
  const planned: Planned[] = parts.map(({ track, samples }) => {
    const base = (samples[0] as Sample).dts;
    const last = samples[samples.length - 1] as Sample;
    return {
      track,
      samples,
      base,
      mediaStart: Math.round(cut * track.timescale + track.shift) - base,
      mediaDuration: last.dts + last.duration - base,
    };
  });

  // Presented duration of each track after the edit list, in movie units.
  const presented = (p: Planned) => {
    const shown = Math.max(0, p.mediaDuration - Math.max(0, p.mediaStart));
    return Math.round((shown * MOVIE_TIMESCALE) / p.track.timescale);
  };
  const emptyEdit = (p: Planned) =>
    p.mediaStart < 0 ? Math.round((-p.mediaStart * MOVIE_TIMESCALE) / p.track.timescale) : 0;
  const movieDuration = Math.max(...planned.map((p) => presented(p) + emptyEdit(p)));

  // The moov is written twice: first to learn its size, then with the real mdat offsets.
  const ftyp = new Writer();
  box(ftyp, 'ftyp', () => {
    ftyp.ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii('mp41');
  });
  const moovFor = (dataStart: number) => {
    const w = new Writer();
    let offset = dataStart;
    box(w, 'moov', () => {
      fullBox(w, 'mvhd', 0, 0, () => {
        w.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movieDuration);
        w.u32(0x10000).u16(0x100).u16(0).u32(0).u32(0);
        for (const v of [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]) w.u32(v);
        for (let i = 0; i < 6; i++) w.u32(0);
        w.u32(Math.max(...planned.map((p) => p.track.id)) + 1);
      });
      for (const p of planned) {
        writeTrak(w, p, offset, presented(p), emptyEdit(p), movieDuration);
        for (const s of p.samples) offset += s.size;
      }
    });
    return w.result();
  };
  const dataStart = ftyp.length + moovFor(0).length + 8;
  const moov = moovFor(dataStart);

  let dataSize = 0;
  for (const p of planned) for (const s of p.samples) dataSize += s.size;
  const out = new Writer();
  out
    .bytes(ftyp.result())
    .bytes(moov)
    .u32(dataSize + 8)
    .ascii('mdat');
  for (const p of planned)
    for (const s of p.samples) out.bytes(d.subarray(s.offset, s.offset + s.size));
  return out.result();
}

function writeTrak(
  w: Writer,
  p: Planned,
  chunkOffset: number,
  presented: number,
  emptyEdit: number,
  movieDuration: number,
): void {
  const t = p.track;
  box(w, 'trak', () => {
    fullBox(w, 'tkhd', 0, 3, () => {
      w.u32(0).u32(0).u32(t.id).u32(0).u32(movieDuration);
      w.u32(0).u32(0).u16(t.tkhd.layer).u16(t.tkhd.altGroup).u16(t.tkhd.volume).u16(0);
      w.bytes(t.tkhd.matrix).u32(t.tkhd.w).u32(t.tkhd.h);
    });
    box(w, 'edts', () => {
      const entries: [number, number][] = [];
      if (emptyEdit > 0) entries.push([emptyEdit, -1]);
      entries.push([presented, Math.max(0, p.mediaStart)]);
      fullBox(w, 'elst', 0, 0, () => {
        w.u32(entries.length);
        for (const [duration, mediaTime] of entries)
          w.u32(duration)
            .u32(mediaTime >>> 0)
            .u32(0x10000);
      });
    });
    box(w, 'mdia', () => {
      fullBox(w, 'mdhd', 0, 0, () => {
        w.u32(0).u32(0).u32(t.timescale).u32(p.mediaDuration).u16(t.language).u16(0);
      });
      w.bytes(t.hdlr);
      box(w, 'minf', () => {
        if (t.mediaHeader) w.bytes(t.mediaHeader);
        box(w, 'dinf', () => {
          fullBox(w, 'dref', 0, 0, () => {
            w.u32(1);
            fullBox(w, 'url ', 0, 1, () => {});
          });
        });
        writeStbl(w, p, chunkOffset);
      });
    });
  });
}

function writeStbl(w: Writer, p: Planned, chunkOffset: number): void {
  const samples = p.samples;
  box(w, 'stbl', () => {
    w.bytes(p.track.stsd);

    const runs: [number, number][] = [];
    for (const s of samples) {
      const lastRun = runs[runs.length - 1];
      if (lastRun && lastRun[1] === s.duration) lastRun[0]++;
      else runs.push([1, s.duration]);
    }
    fullBox(w, 'stts', 0, 0, () => {
      w.u32(runs.length);
      for (const [n, delta] of runs) w.u32(n).u32(delta);
    });

    if (samples.some((s) => s.cto !== 0)) {
      const ctoRuns: [number, number][] = [];
      for (const s of samples) {
        const lastRun = ctoRuns[ctoRuns.length - 1];
        if (lastRun && lastRun[1] === s.cto) lastRun[0]++;
        else ctoRuns.push([1, s.cto]);
      }
      fullBox(w, 'ctts', samples.some((s) => s.cto < 0) ? 1 : 0, 0, () => {
        w.u32(ctoRuns.length);
        for (const [n, cto] of ctoRuns) w.u32(n).u32(cto >>> 0);
      });
    }

    if (p.track.kind === 'video' && samples.some((s) => !s.sync)) {
      const sync = samples.flatMap((s, i) => (s.sync ? [i + 1] : []));
      fullBox(w, 'stss', 0, 0, () => {
        w.u32(sync.length);
        for (const n of sync) w.u32(n);
      });
    }

    // All samples of a track form one chunk.
    fullBox(w, 'stsc', 0, 0, () => {
      w.u32(1).u32(1).u32(samples.length).u32(1);
    });
    fullBox(w, 'stsz', 0, 0, () => {
      w.u32(0).u32(samples.length);
      for (const s of samples) w.u32(s.size);
    });
    fullBox(w, 'stco', 0, 0, () => {
      w.u32(1).u32(chunkOffset);
    });
  });
}
