import {
  withCrop,
  withPadColor,
  withResize,
  type Crop,
  type DocumentState,
  type Rect,
  type Rotation,
  type ScaleMode,
} from './document';
import {
  anchoredRect,
  baseRect,
  clampRect,
  nativeSize as rectNativeSize,
  rectLimits,
  rectZoom,
  resizeRect,
  rotatedSize,
  type Handle,
  type Size,
} from './rect';
import { SNAP_TOLERANCE, mudaeExportSize, mudaeScaleOf, presetForRatio, snapRatio } from './ratios';

/**
 * A Source rotated by 90° or 270° swaps its axes. Every rect and clamp is
 * computed from these bounds, so a rotated Source is never squashed.
 */
function boundsFor(doc: DocumentState, rotation: Rotation): Size {
  return rotatedSize(doc.source, rotation);
}

export function rotatedBounds(doc: DocumentState): Size {
  return boundsFor(doc, doc.crop.rotation);
}

/** The Frame window over the rotated Source. */
export function frameRect(doc: DocumentState): Rect {
  return doc.crop.rect;
}

/** The mode's rect at zoom 1 for the crop being applied. */
export function baseRectFor(doc: DocumentState, crop: Crop = doc.crop): Rect {
  return baseRect(boundsFor(doc, crop.rotation), doc.frame.ratio, crop.mode);
}

export function zoomOf(doc: DocumentState): number {
  return rectZoom(rotatedBounds(doc), doc.frame.ratio, doc.crop.mode, doc.crop.rect);
}

export function clampCrop(doc: DocumentState, crop: Crop): Crop {
  const rect = clampRect(boundsFor(doc, crop.rotation), doc.frame.ratio, crop.mode, crop.rect);
  return { ...crop, rect };
}

export interface PanOptions {
  /** Snap the window's centre to the Source's centre on each axis. */
  readonly snapCenter?: boolean;
  /** Distance in rotated Source px within which the centre snaps. */
  readonly threshold?: number;
}

/** Which axes would land on the Source's centre for this pan delta. */
export interface CentreSnap {
  readonly x: boolean;
  readonly y: boolean;
}

/**
 * Report the axes a pan would snap to the Source's centre. The stage uses it
 * to show the guide lines for exactly the axes `panBy` is holding.
 */
export function centreSnapAxes(
  bounds: Size,
  rect: Rect,
  dx: number,
  dy: number,
  threshold: number,
): CentreSnap {
  const limit = Math.max(0, threshold);
  return {
    x: Math.abs(rect.x + rect.width / 2 + dx - bounds.width / 2) <= limit,
    y: Math.abs(rect.y + rect.height / 2 + dy - bounds.height / 2) <= limit,
  };
}

/** Pan by a delta expressed in rotated Source pixels. */
export function panBy(
  doc: DocumentState,
  crop: Crop,
  dx: number,
  dy: number,
  options: PanOptions = {},
): Crop {
  let nextDx = dx;
  let nextDy = dy;
  if (options.snapCenter && doc.source) {
    const bounds = boundsFor(doc, crop.rotation);
    const rect = crop.rect;
    const snapped = centreSnapAxes(bounds, rect, dx, dy, options.threshold ?? 0);
    if (snapped.x) {
      nextDx = bounds.width / 2 - (rect.x + rect.width / 2);
    }
    if (snapped.y) {
      nextDy = bounds.height / 2 - (rect.y + rect.height / 2);
    }
  }
  return clampCrop(doc, {
    ...crop,
    rect: { ...crop.rect, x: crop.rect.x + nextDx, y: crop.rect.y + nextDy },
  });
}

export interface ResizeOptions {
  readonly locked: boolean;
  readonly snap: boolean;
  /**
   * The proportion the drag started on. It is excluded from snapping so the
   * drag never pulls back to where it began; a snapped target still holds.
   */
  readonly startRatio?: number;
}

/**
 * Resize the Frame window from a handle drag. Locked keeps the Frame proportion;
 * a free drag returns the new ratio. With snapping on, a free ratio within 2%
 * of a preset lands exactly on it while preserving the dragged axis.
 */
export function resizeCrop(
  doc: DocumentState,
  crop: Crop,
  handle: Handle,
  dx: number,
  dy: number,
  options: ResizeOptions,
): { crop: Crop; ratio: number } {
  const bounds = boundsFor(doc, crop.rotation);
  const resized = resizeRect(
    bounds,
    doc.frame.ratio,
    crop.rect,
    handle,
    dx,
    dy,
    options.locked,
    crop.mode,
  );
  let ratio = resized.ratio;
  let rect = resized.rect;

  // Exclude only the proportion the drag started on. Every other preset stays a
  // target, so once the drag snaps it keeps holding for the rest of the drag.
  if (!options.locked && options.snap) {
    const preset = snapRatio(ratio, SNAP_TOLERANCE, options.startRatio ?? doc.frame.ratio);
    if (preset) {
      ratio = preset.ratio;
      const horizontal = handle.includes('e') || handle.includes('w');
      // Edge drags keep their manipulated axis; corners keep the width.
      const width = horizontal ? rect.width : rect.height * ratio;
      const height = horizontal ? width / ratio : rect.height;
      rect = clampRect(bounds, ratio, crop.mode, anchoredRect(crop.rect, handle, width, height));
    }
  }

  return { crop: { ...crop, rect }, ratio };
}

/**
 * The one place that writes both halves of the document invariant: the Frame
 * proportion and the Crop rect always change together, and a locked Export size
 * follows the new proportion.
 */
function withFrameRect(doc: DocumentState, ratio: number, rect: Rect): DocumentState {
  const next: DocumentState = { ...doc, frame: { ratio }, crop: { ...doc.crop, rect } };
  return doc.resize && doc.resizeLocked ? withResize(next, doc.resize) : next;
}

/** Apply a handle drag to the document, Frame and Crop together. */
export function resizeFrame(
  doc: DocumentState,
  handle: Handle,
  dx: number,
  dy: number,
  options: ResizeOptions,
): DocumentState {
  if (!doc.source) return doc;
  const result = resizeCrop(doc, doc.crop, handle, dx, dy, options);
  return withFrameRect(doc, result.ratio, result.crop.rect);
}

/**
 * Set the zoom readout: the rect keeps the Frame proportion around its centre,
 * then clamps to the mode's limits.
 */
export function zoomTo(doc: DocumentState, zoom: number): DocumentState {
  const base = baseRectFor(doc);
  if (base.width <= 0 || !Number.isFinite(zoom) || zoom <= 0) return doc;
  const rect = doc.crop.rect;
  const width = base.width / zoom;
  const height = base.height / zoom;
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const clamped = clampCrop(doc, {
    ...doc.crop,
    rect: { x: centreX - width / 2, y: centreY - height / 2, width, height },
  });
  return withFrameRect(doc, doc.frame.ratio, clamped.rect);
}

function clampWidth(bounds: Size, doc: DocumentState, crop: Crop, width: number): number {
  const { minWidth, maxWidth } = rectLimits(bounds, doc.frame.ratio, crop.mode);
  if (!Number.isFinite(width)) return maxWidth;
  return Math.min(maxWidth, Math.max(minWidth, width));
}

/**
 * Zoom by `factor` while keeping the rotated Source point under `point` in
 * place. The rect keeps the Frame proportion, so the two axes scale together.
 */
export function zoomAt(
  doc: DocumentState,
  crop: Crop,
  factor: number,
  point: { x: number; y: number },
): Crop {
  if (!doc.source) return crop;
  if (!Number.isFinite(factor) || factor <= 0) return crop;
  if (crop.rect.width <= 0 || crop.rect.height <= 0) return crop;
  const bounds = boundsFor(doc, crop.rotation);
  const width = clampWidth(bounds, doc, crop, crop.rect.width / factor);
  const height = width / doc.frame.ratio;
  const scale = width / crop.rect.width;

  return clampCrop(doc, {
    ...crop,
    rect: {
      x: point.x - (point.x - crop.rect.x) * scale,
      y: point.y - (point.y - crop.rect.y) * scale,
      width,
      height,
    },
  });
}

/** Rotate in 90° steps, moving the rect's centre into the new bounds. */
export function rotate90(doc: DocumentState, crop: Crop): Crop {
  const rotation = ((crop.rotation + 90) % 360) as Rotation;
  if (!doc.source) return { ...crop, rotation };
  const before = boundsFor(doc, crop.rotation);
  const centreX = crop.rect.x + crop.rect.width / 2;
  const centreY = crop.rect.y + crop.rect.height / 2;
  // Clockwise: the old bottom-left becomes the new top-left.
  const nextCentreX = before.height - centreY;
  const nextCentreY = centreX;

  return clampCrop(doc, {
    ...crop,
    rotation,
    rect: {
      x: nextCentreX - crop.rect.width / 2,
      y: nextCentreY - crop.rect.height / 2,
      width: crop.rect.width,
      height: crop.rect.height,
    },
  });
}

/** Reset zoom, pan and rotation to the current Scale mode's default. */
export function resetCrop(doc: DocumentState): Crop {
  return {
    mode: doc.crop.mode,
    rect: baseRectFor(doc, { ...doc.crop, rotation: 0 }),
    rotation: 0,
  };
}

/**
 * Apply a Scale mode to the document. The first time Pad is enabled, its color
 * starts from the current Border color; after that the two stay independent.
 */
export function applyScaleMode(doc: DocumentState, mode: ScaleMode): DocumentState {
  const next = withCrop(
    doc,
    clampCrop(doc, {
      mode,
      rotation: doc.crop.rotation,
      rect: baseRectFor(doc, { ...doc.crop, mode }),
    }),
  );
  if (mode === 'pad' && doc.crop.mode !== 'pad' && !doc.padColorExplicit) {
    return withPadColor(next, doc.border.color);
  }
  return next;
}

/**
 * Change the Frame proportion keeping the current long side and the rect centre,
 * then clamp. A requested ratio within 0.1% of a preset is stored as that
 * preset's exact value, so labels, Carta and persistence agree.
 */
export function applyRatio(doc: DocumentState, ratio: number): DocumentState {
  if (!Number.isFinite(ratio) || ratio <= 0) return doc;
  // A ratio close enough to be *called* a preset is stored as the exact one, so
  // labels, Carta presets, snapping and persistence all agree.
  const preset = presetForRatio(ratio);
  const target = preset ? preset.ratio : ratio;
  const keptCarta = doc.resize ? mudaeScaleOf(doc.resize, doc.frame.ratio) : null;
  const rect = doc.crop.rect;
  // Keep the axis that currently holds the long side, and derive the other
  // axis from the new ratio: 9:14 → 16:9 keeps the height and grows the width.
  // A square has no long side, so it keeps its width.
  const keepWidth = rect.width >= rect.height;
  const width = keepWidth ? rect.width : rect.height * target;
  const height = keepWidth ? rect.width / target : rect.height;
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const framed: DocumentState = { ...doc, frame: { ratio: target } };
  const clamped = clampCrop(framed, {
    ...doc.crop,
    rect: {
      x: centreX - width / 2,
      y: centreY - height / 2,
      width,
      height,
    },
  });
  const next = withFrameRect(doc, target, clamped.rect);
  if (!next.resize) return next;
  // Flipping between the Mudae orientations keeps the chosen Carta, instead of
  // re-deriving its height from the new proportion (which would not be a Carta).
  // A Carta stays a Carta even if the lock was switched off.
  const carta = keptCarta !== null ? mudaeExportSize(target, keptCarta) : null;
  return carta ? withResize(next, carta) : next;
}

/** The native Export size: the rect's pixels, rounded and at least 1. */
export function nativeSize(doc: DocumentState): Size {
  return rectNativeSize(doc.crop.rect);
}

/** The rect centre's offset from the Source centre, as a fraction of the rect. */
export function offsetPct(doc: DocumentState): { x: number; y: number } {
  const bounds = rotatedBounds(doc);
  const rect = doc.crop.rect;
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: (rect.x + rect.width / 2 - bounds.width / 2) / rect.width,
    y: (rect.y + rect.height / 2 - bounds.height / 2) / rect.height,
  };
}
