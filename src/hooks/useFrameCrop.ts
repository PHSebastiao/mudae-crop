import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { withCrop, type DocumentState, type ScaleMode } from '../core/document';
import {
  applyRatio,
  applyScaleMode,
  offsetPct,
  panBy,
  resetCrop,
  resizeFrame as resizeFrameDocument,
  rotate90,
  zoomAt,
  zoomTo,
} from '../core/geometry';
import { presetForRatio } from '../core/ratios';
import type { Handle } from '../core/rect';
import type { Settings } from '../core/settings';

interface FrameCropOptions {
  readonly doc: DocumentState;
  readonly setDoc: Dispatch<SetStateAction<DocumentState>>;
  readonly snapRatios: boolean;
  readonly persistSettings: (patch: Partial<Settings>) => void;
  readonly playing: boolean;
  readonly setPlaying: Dispatch<SetStateAction<boolean>>;
  /** Any crop interaction leaves the Pad eyedropper. */
  readonly leavePick: () => void;
}

export interface FrameCrop {
  readonly adjustFrame: boolean;
  readonly snapRatios: boolean;
  readonly changeMode: (mode: ScaleMode) => void;
  readonly changeRatio: (ratio: number) => void;
  readonly changeZoom: (zoom: number) => void;
  readonly changeOffset: (offsetX: number, offsetY: number) => void;
  readonly resizeFrame: (
    handle: Handle,
    dx: number,
    dy: number,
    locked: boolean,
    snap: boolean,
    startRatio?: number,
  ) => void;
  readonly zoomAtPoint: (point: { x: number; y: number }, factor: number) => void;
  readonly pan: (dx: number, dy: number, snapCenter: boolean, threshold: number) => void;
  readonly rotate: () => void;
  readonly reset: () => void;
  readonly toggleAdjustFrame: () => void;
  readonly closeAdjustFrame: () => void;
  readonly changeSnapRatios: (enabled: boolean) => void;
  /** Tell the hook a proportion was loaded from disk, so it is not written back. */
  readonly markRatioPersisted: (ratio: number) => void;
}

/**
 * Owns the Frame/Crop controller: adjust mode, snapping, the document-level
 * crop commands and the proportion persistence. `App` keeps the wiring and
 * the platform adapters; this hook never touches DOM APIs beyond `window`.
 */
export function useFrameCrop({
  doc,
  setDoc,
  snapRatios,
  persistSettings,
  playing,
  setPlaying,
  leavePick,
}: FrameCropOptions): FrameCrop {
  const [adjustFrame, setAdjustFrame] = useState(false);
  const persistedFrameRatioRef = useRef(doc.frame.ratio);

  // A preset ratio is remembered for the next launch; a free Personalizado
  // ratio never overwrites the stored value. Only the settled proportion is
  // stored: a free drag that passes through a preset on its way to
  // Personalizado must not save that preset.
  useEffect(() => {
    const ratio = doc.frame.ratio;
    if (ratio === persistedFrameRatioRef.current) return;
    persistedFrameRatioRef.current = ratio;
    const preset = presetForRatio(ratio);
    if (!preset) return;
    const timer = window.setTimeout(() => persistSettings({ frameRatio: preset.ratio }), 600);
    return () => window.clearTimeout(timer);
  }, [doc.frame.ratio, persistSettings]);

  // The crop phase freezes the preview: a moving Source under the handles is
  // distracting and makes the framing harder to judge. Playback resumes when
  // the phase ends, but only if it was playing when it started.
  const adjustWasOnRef = useRef(false);
  const resumeAfterAdjustRef = useRef(false);
  useEffect(() => {
    if (adjustFrame === adjustWasOnRef.current) return;
    adjustWasOnRef.current = adjustFrame;
    if (adjustFrame) {
      if (playing) {
        resumeAfterAdjustRef.current = true;
        setPlaying(false);
      }
    } else if (resumeAfterAdjustRef.current) {
      resumeAfterAdjustRef.current = false;
      setPlaying(true);
    }
  }, [adjustFrame, playing, setPlaying]);

  const changeMode = useCallback(
    (mode: ScaleMode) => setDoc((current) => applyScaleMode(current, mode)),
    [setDoc],
  );

  const changeRatio = useCallback(
    (ratio: number) => {
      leavePick();
      setDoc((current) => applyRatio(current, ratio));
    },
    [leavePick, setDoc],
  );

  const changeZoom = useCallback(
    (zoom: number) => setDoc((current) => zoomTo(current, zoom)),
    [setDoc],
  );

  const changeOffset = useCallback(
    (offsetX: number, offsetY: number) => {
      setDoc((current) => {
        const rect = current.crop.rect;
        if (rect.width <= 0 || rect.height <= 0) return current;
        const pct = offsetPct(current);
        const dx = (offsetX / 100 - pct.x) * rect.width;
        const dy = (offsetY / 100 - pct.y) * rect.height;
        return withCrop(current, panBy(current, current.crop, dx, dy));
      });
    },
    [setDoc],
  );

  const resizeFrame = useCallback(
    (
      handle: Handle,
      dx: number,
      dy: number,
      locked: boolean,
      snap: boolean,
      startRatio?: number,
    ) => {
      setDoc((current) =>
        resizeFrameDocument(current, handle, dx, dy, { locked, snap, startRatio }),
      );
    },
    [setDoc],
  );

  const zoomAtPoint = useCallback(
    (point: { x: number; y: number }, factor: number) => {
      setDoc((current) =>
        current.source ? withCrop(current, zoomAt(current, current.crop, factor, point)) : current,
      );
    },
    [setDoc],
  );

  const pan = useCallback(
    (dx: number, dy: number, snapCenter: boolean, threshold: number) => {
      setDoc((current) =>
        current.source
          ? withCrop(current, panBy(current, current.crop, dx, dy, { snapCenter, threshold }))
          : current,
      );
    },
    [setDoc],
  );

  const rotate = useCallback(
    () => setDoc((current) => withCrop(current, rotate90(current, current.crop))),
    [setDoc],
  );

  const reset = useCallback(
    () => setDoc((current) => withCrop(current, resetCrop(current))),
    [setDoc],
  );

  const toggleAdjustFrame = useCallback(() => {
    // Turning the crop phase on cancels the Pad eyedropper: the two stage
    // interactions never overlap.
    leavePick();
    setAdjustFrame((value) => !value);
  }, [leavePick]);

  const closeAdjustFrame = useCallback(() => setAdjustFrame(false), []);

  const changeSnapRatios = useCallback(
    (enabled: boolean) => persistSettings({ snapRatios: enabled }),
    [persistSettings],
  );

  const markRatioPersisted = useCallback((ratio: number) => {
    persistedFrameRatioRef.current = ratio;
  }, []);

  return {
    adjustFrame,
    snapRatios,
    changeMode,
    changeRatio,
    changeZoom,
    changeOffset,
    resizeFrame,
    zoomAtPoint,
    pan,
    rotate,
    reset,
    toggleAdjustFrame,
    closeAdjustFrame,
    changeSnapRatios,
    markRatioPersisted,
  };
}
