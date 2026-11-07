import {
  defaultCrop,
  withCrop,
  withPadColor,
  type Crop,
  type DocumentState,
  type Rotation,
  type ScaleMode,
} from './document';

export const MAX_ZOOM = 8;

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

/**
 * A Source rotated by 90° or 270° swaps its axes. Every scale and pan limit is
 * computed from these bounds, so a rotated Source is never squashed.
 */
function boundsFor(doc: DocumentState, rotation: Rotation): Bounds {
  if (!doc.source) return { width: 0, height: 0 };
  return rotation === 90 || rotation === 270
    ? { width: doc.source.height, height: doc.source.width }
    : { width: doc.source.width, height: doc.source.height };
}

export function rotatedBounds(doc: DocumentState): Bounds {
  return boundsFor(doc, doc.crop.rotation);
}

function coverScale(bounds: Bounds, doc: DocumentState): number {
  return Math.max(doc.frame.width / bounds.width, doc.frame.height / bounds.height);
}

function containScale(bounds: Bounds, doc: DocumentState): number {
  return Math.min(doc.frame.width / bounds.width, doc.frame.height / bounds.height);
}

/** The Fit scale: the larger ratio, so there are never bars. */
export function fitScale(doc: DocumentState): number {
  if (!doc.source) return 1;
  return coverScale(boundsFor(doc, doc.crop.rotation), doc);
}

/** The Pad scale: the smaller ratio, so the whole Source stays inside. */
export function padScale(doc: DocumentState): number {
  if (!doc.source) return 1;
  return containScale(boundsFor(doc, doc.crop.rotation), doc);
}

/** The base scale of a mode, before zoom is applied. */
export function scaleForMode(doc: DocumentState, crop: Crop = doc.crop): number {
  if (!doc.source) return 1;
  const bounds = boundsFor(doc, crop.rotation);
  switch (crop.mode) {
    case 'pad':
      return containScale(bounds, doc);
    case 'full-width':
      return doc.frame.width / bounds.width;
    case 'full-height':
      return doc.frame.height / bounds.height;
    case 'fit':
    default:
      return coverScale(bounds, doc);
  }
}

/** The uniform scale applied to the Source, combining the mode and zoom. */
export function effectiveScale(doc: DocumentState): number {
  return scaleForMode(doc) * doc.crop.zoom;
}

/**
 * Zoom limits as multipliers of the mode's scale. The resulting absolute scale
 * runs from the Pad scale (or Fit, which must always cover) up to 8× Fit.
 */
export function zoomLimitsFor(doc: DocumentState, crop: Crop): { min: number; max: number } {
  if (!doc.source) return { min: 1, max: 1 };
  const bounds = boundsFor(doc, crop.rotation);
  const base = scaleForMode(doc, crop);
  const cover = coverScale(bounds, doc);
  const low = crop.mode === 'fit' ? cover : containScale(bounds, doc);
  return { min: low / base, max: (MAX_ZOOM * cover) / base };
}

export function zoomLimits(doc: DocumentState): { min: number; max: number } {
  return zoomLimitsFor(doc, doc.crop);
}

export function clampZoomFor(doc: DocumentState, crop: Crop, zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const limits = zoomLimitsFor(doc, crop);
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

export function clampZoom(doc: DocumentState, zoom: number): number {
  return clampZoomFor(doc, doc.crop, zoom);
}

function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The largest offset that still lets the Source cover the Frame on each axis.
 * An axis the Source cannot cover stays centred, so Pad never drifts.
 */
export function panLimitsAtCrop(doc: DocumentState, crop: Crop): { x: number; y: number } {
  if (!doc.source) return { x: 0, y: 0 };
  const bounds = boundsFor(doc, crop.rotation);
  const scale = scaleForMode(doc, crop) * crop.zoom;
  return {
    x: Math.max(0, (bounds.width * scale - doc.frame.width) / 2),
    y: Math.max(0, (bounds.height * scale - doc.frame.height) / 2),
  };
}

export function panLimits(doc: DocumentState): { x: number; y: number } {
  return panLimitsAtCrop(doc, doc.crop);
}

export function clampCrop(doc: DocumentState, crop: Crop): Crop {
  const zoom = clampZoomFor(doc, crop, crop.zoom);
  // Limits belong to the zoom being applied, not the one in the document.
  const limits = panLimitsAtCrop(doc, { ...crop, zoom });
  return {
    ...crop,
    zoom,
    offsetX: withoutNegativeZero(Math.min(limits.x, Math.max(-limits.x, crop.offsetX))),
    offsetY: withoutNegativeZero(Math.min(limits.y, Math.max(-limits.y, crop.offsetY))),
  };
}

/** Pan by a delta expressed in Frame pixels at 1×. */
export function panBy(doc: DocumentState, crop: Crop, dx: number, dy: number): Crop {
  return clampCrop(doc, { ...crop, offsetX: crop.offsetX + dx, offsetY: crop.offsetY + dy });
}

/**
 * Zoom while keeping the Source point under `point` (Frame pixels at 1×) in
 * place. The combined mode + zoom scale changes, so the offset is recomputed
 * before being clamped.
 */
export function zoomAt(
  doc: DocumentState,
  crop: Crop,
  nextZoom: number,
  point: { x: number; y: number },
): Crop {
  if (!doc.source) return crop;
  const zoom = clampZoomFor(doc, crop, nextZoom);
  const base = scaleForMode(doc, crop);
  const before = base * crop.zoom;
  const after = base * zoom;
  const bounds = boundsFor(doc, crop.rotation);

  // Source fraction under the pointer, using the current draw rectangle.
  const left = doc.frame.width / 2 + crop.offsetX - (bounds.width * before) / 2;
  const u = (point.x - left) / (bounds.width * before);

  // Keep that fraction under the same Frame point at the new scale.
  const offsetX = point.x + (0.5 - u) * bounds.width * after - doc.frame.width / 2;
  const offsetY = (() => {
    const top = doc.frame.height / 2 + crop.offsetY - (bounds.height * before) / 2;
    const v = (point.y - top) / (bounds.height * before);
    return point.y + (0.5 - v) * bounds.height * after - doc.frame.height / 2;
  })();

  return clampCrop(doc, { ...crop, zoom, offsetX, offsetY });
}

/** Rotate in 90° steps, keeping the pan inside the new, swapped bounds. */
export function rotate90(doc: DocumentState, crop: Crop): Crop {
  const rotation = ((crop.rotation + 90) % 360) as Rotation;
  return clampCrop(doc, { ...crop, rotation });
}

/** A Scale mode change snaps the Crop to that mode's default zoom and centring. */
export function setScaleMode(crop: Crop, mode: ScaleMode): Crop {
  return defaultCrop(mode, crop.rotation);
}

/**
 * Apply a Scale mode to the document. The first time Pad is enabled, its color
 * starts from the current Border color; after that the two stay independent.
 */
export function applyScaleMode(doc: DocumentState, mode: ScaleMode): DocumentState {
  const next = withCrop(doc, clampCrop(doc, setScaleMode(doc.crop, mode)));
  if (mode === 'pad' && doc.crop.mode !== 'pad' && !doc.padColorExplicit) {
    return withPadColor(next, doc.border.color);
  }
  return next;
}

/** Reset zoom, pan and rotation to the current Scale mode's default. */
export function resetCrop(crop: Crop): Crop {
  return defaultCrop(crop.mode);
}

/** The rotated Source draw rectangle inside the Frame at 1×, before output scaling. */
export function sourceRect(doc: DocumentState): { x: number; y: number; width: number; height: number } {
  if (!doc.source) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = effectiveScale(doc);
  const bounds = rotatedBounds(doc);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  return {
    x: doc.frame.width / 2 + doc.crop.offsetX - width / 2,
    y: doc.frame.height / 2 + doc.crop.offsetY - height / 2,
    width,
    height,
  };
}
