/**
 * Quality levels chosen before recording (concept section 6). The phone records directly at this
 * quality; nothing is re-compressed afterwards. Values are a first guess and are meant to be
 * tuned with the results of the video test page.
 */
export type Quality = 'saver' | 'normal' | 'hd';

export interface QualityPreset {
  width: number;
  height: number;
  frameRate: number;
  videoBitsPerSecond: number;
  audioBitsPerSecond: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  saver: {
    width: 854,
    height: 480,
    frameRate: 30,
    videoBitsPerSecond: 1_000_000,
    audioBitsPerSecond: 64_000,
  },
  normal: {
    width: 1280,
    height: 720,
    frameRate: 30,
    videoBitsPerSecond: 2_500_000,
    audioBitsPerSecond: 96_000,
  },
  hd: {
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoBitsPerSecond: 6_000_000,
    audioBitsPerSecond: 128_000,
  },
};

export const QUALITIES = Object.keys(QUALITY_PRESETS) as Quality[];

/** Expected file size in MB per minute (video + audio bit rate). */
export function expectedMbPerMinute(q: QualityPreset): number {
  return ((q.videoBitsPerSecond + q.audioBitsPerSecond) * 60) / 8 / 1_000_000;
}
