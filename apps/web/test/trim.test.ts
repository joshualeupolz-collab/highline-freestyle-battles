import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeVideo, TrimError, trimVideo } from '../src/video/trim';

/**
 * Fixtures: real MediaRecorder output of Chromium (WebM/VP8 and fragmented MP4/VP9, keyframe
 * every second) and ffmpeg files shaped like Safari's (fragmented H.264/AAC) and like a camera
 * app's (classic MP4 with B-frames). Each is about 3.5–4 s long with keyframes about 1 s apart.
 */
const FIXTURES = [
  'chrome-vp8-opus.webm',
  'chrome-vp9-opus.mp4',
  'h264-aac-fragmented.mp4',
  'h264-aac-bframes.mp4',
];

function load(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', name)));
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.each(FIXTURES)('%s', (name) => {
  const source = load(name);
  const info = analyzeVideo(source);
  const videoTrack = info.tracks.find((t) => t.kind === 'video');

  it('is analyzed: duration, keyframes, tracks', () => {
    expect(info.duration).toBeGreaterThan(3.4);
    expect(info.duration).toBeLessThan(4.1);
    expect(info.keyframes).toHaveLength(4);
    expect(info.keyframes[0]).toBeLessThan(0.05);
    expect(info.tracks.map((t) => t.kind).sort()).toEqual(['audio', 'video']);
    expect(info.truncated).toBe(false);
  });

  it('starts a cut at the keyframe at or before the requested start', () => {
    const result = trimVideo(source, 1.5, 2.8);
    const keyframe = info.keyframes.filter((k) => k <= 1.5).at(-1) ?? 0;
    expect(result.start).toBeCloseTo(keyframe, 2);
    expect(result.end).toBeGreaterThan(2.7);
    expect(result.end).toBeLessThan(2.95);
    expect(result.info.keyframes[0]).toBeLessThan(0.01);
    expect(result.info.keyframes).toHaveLength(2);
    expect(result.bytes.length).toBeLessThan(source.length * 0.7);
    // The output is a normal file again: it can be analyzed and cut once more.
    expect(trimVideo(result.bytes, 0.5, 1).start).toBeCloseTo(0, 2);
  });

  it('keeps every video frame when rewriting the whole file', () => {
    const result = trimVideo(source, 0, Number.POSITIVE_INFINITY);
    expect(result.info.tracks.find((t) => t.kind === 'video')?.samples).toBe(videoTrack?.samples);
    expect(result.info.duration).toBeCloseTo(info.duration, 0);
  });

  it('reads a file cut off in the middle (recording rescued after a crash)', () => {
    const partial = source.slice(0, Math.floor(source.length * 0.7));
    const cut = analyzeVideo(partial);
    expect(cut.truncated).toBe(true);
    const frames = cut.tracks.find((t) => t.kind === 'video')?.samples ?? 0;
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(videoTrack?.samples ?? 0);
    expect(trimVideo(partial, 0, Number.POSITIVE_INFINITY).info.truncated).toBe(false);
  });

  it.skipIf(!hasFfmpeg)('produces files ffmpeg decodes without errors', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hfb-trim-'));
    const file = join(dir, `out-${name}`);
    writeFileSync(file, trimVideo(source, 1.2, 3).bytes);
    const run = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
    expect(run.status).toBe(0);
    expect(run.stderr.toString()).toBe('');
  });
});

describe('errors', () => {
  it('rejects unknown data', () => {
    expect(() => analyzeVideo(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(TrimError);
  });

  it('rejects an end before the start', () => {
    expect(() => trimVideo(load(FIXTURES[0] as string), 2, 1)).toThrow(TrimError);
  });
});
