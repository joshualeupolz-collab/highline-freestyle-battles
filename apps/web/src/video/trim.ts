/** Entry points for analyzing and cutting a recording, whatever container the browser produced. */
import { TrimError } from './bytes';
import { analyzeMp4, isMp4, trimMp4 } from './mp4';
import type { TrimResult, VideoInfo } from './types';
import { analyzeWebm, isWebm, trimWebm } from './webm';

export type { TrimResult, VideoInfo };
export { TrimError };

export function analyzeVideo(bytes: Uint8Array): VideoInfo {
  if (isMp4(bytes)) return analyzeMp4(bytes);
  if (isWebm(bytes)) return analyzeWebm(bytes);
  throw new TrimError('Unknown video format (neither MP4 nor WebM)');
}

/**
 * Cuts the part from `start` to `end` (seconds) without re-encoding. The result starts at the
 * last keyframe at or before `start`; `result.start` says where exactly.
 * `trimVideo(bytes, 0, Infinity)` rewrites the whole file, which makes a raw MediaRecorder
 * file seekable (Chrome's WebM has no duration and no index).
 */
export function trimVideo(bytes: Uint8Array, start: number, end: number): TrimResult {
  if (!(end > start)) throw new TrimError('The end must be after the start');
  if (isMp4(bytes)) return trimMp4(bytes, Math.max(0, start), end);
  if (isWebm(bytes)) return trimWebm(bytes, Math.max(0, start), end);
  throw new TrimError('Unknown video format (neither MP4 nor WebM)');
}
