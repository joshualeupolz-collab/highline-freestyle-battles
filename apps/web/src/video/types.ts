/** What the analysis of a recorded file returns (shown on the video test page). */
export interface VideoInfo {
  container: 'mp4' | 'webm';
  /** MIME type to use for a Blob of this file. */
  mimeType: string;
  /** Seconds, from the first to the end of the last frame/audio packet. */
  duration: number;
  /** Presentation times (seconds, starting at 0) of the video keyframes = possible cut starts. */
  keyframes: number[];
  tracks: TrackInfo[];
  /** The file ends in the middle of a box/element, e.g. a recording rescued after a crash. */
  truncated: boolean;
}

export interface TrackInfo {
  kind: 'video' | 'audio' | 'other';
  codec: string;
  samples: number;
  width?: number;
  height?: number;
}

export interface TrimResult {
  bytes: Uint8Array;
  mimeType: string;
  /** Actual start in the source (seconds): the keyframe at or before the requested start. */
  start: number;
  /** Actual end in the source (seconds). */
  end: number;
  info: VideoInfo;
}
