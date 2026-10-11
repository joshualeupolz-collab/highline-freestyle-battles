/**
 * Zooming the camera with two fingers (owner's wish). Uses the camera's own zoom (`zoom`
 * constraint, e.g. Chrome on Android), so the recording is zoomed too. Where the browser offers
 * no camera zoom (e.g. Safari), pinching does nothing: the page itself must not zoom, or the
 * record button would move out of view.
 */
import { type TouchEvent, useCallback, useEffect, useRef, useState } from 'react';

interface ZoomRange {
  min: number;
  max: number;
}

// `zoom` is not in TypeScript's DOM types yet.
type ZoomTrack = Omit<MediaStreamTrack, 'getCapabilities' | 'getSettings'> & {
  getCapabilities?: () => { zoom?: ZoomRange };
  getSettings: () => { zoom?: number };
};

function distance(e: TouchEvent): number {
  const [a, b] = [e.touches[0], e.touches[1]];
  if (!a || !b) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function useCameraZoom(stream: MediaStream | null) {
  const [range, setRange] = useState<ZoomRange | null>(null);
  const [value, setValue] = useState(1);
  const track = useRef<ZoomTrack | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const t = (stream?.getVideoTracks()[0] ?? null) as ZoomTrack | null;
    track.current = t;
    const zoom = t?.getCapabilities?.().zoom;
    if (zoom && zoom.max > zoom.min) {
      setRange({ min: zoom.min, max: zoom.max });
      setValue(t?.getSettings().zoom ?? zoom.min);
    } else {
      setRange(null);
    }
  }, [stream]);

  // iOS Safari: stop its own pinch gesture on the camera screen (touch-action is not enough).
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block);
    return () => document.removeEventListener('gesturestart', block);
  }, []);

  const apply = useCallback(
    (next: number) => {
      if (!range || !track.current) return;
      const z = Math.min(range.max, Math.max(range.min, next));
      setValue(z);
      // At most one constraint change per frame.
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        track.current
          ?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] })
          .catch(() => {});
      });
    },
    [range],
  );

  const handlers = {
    style: { touchAction: 'none' as const },
    onTouchStart: (e: TouchEvent) => {
      if (e.touches.length === 2) pinch.current = { distance: distance(e), zoom: value };
    },
    onTouchMove: (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch.current || pinch.current.distance === 0) return;
      apply(pinch.current.zoom * (distance(e) / pinch.current.distance));
    },
    onTouchEnd: () => {
      pinch.current = null;
    },
  };

  return { available: range !== null, value, handlers };
}
