import type { Crop, DocumentState } from './document';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

/**
 * Fit covers the Frame completely: the larger of the two ratios, so overflow
 * is cropped on one axis and there are never bars.
 */
export function fitScale(doc: DocumentState): number {
  if (!doc.source) return 1;
  return Math.max(doc.frame.width / doc.source.width, doc.frame.height / doc.source.height);
}

/** The uniform scale applied to the Source, combining Fit and zoom. */
export function effectiveScale(doc: DocumentState): number {
  return fitScale(doc) * doc.crop.zoom;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The largest offset that still lets the Source cover the Frame on each axis.
 * A Source narrower than the Frame on an axis cannot pan on that axis.
 */
export function panLimits(doc: DocumentState): { x: number; y: number } {
  return panLimitsAtZoom(doc, doc.crop.zoom);
}

export function panLimitsAtZoom(doc: DocumentState, zoom: number): { x: number; y: number } {
  if (!doc.source) return { x: 0, y: 0 };
  const scale = fitScale(doc) * zoom;
  return {
    x: Math.max(0, (doc.source.width * scale - doc.frame.width) / 2),
    y: Math.max(0, (doc.source.height * scale - doc.frame.height) / 2),
  };
}

function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

export function clampCrop(doc: DocumentState, crop: Crop): Crop {
  const zoom = clampZoom(crop.zoom);
  // Limits belong to the zoom being applied, not the one in the document.
  const limits = panLimitsAtZoom(doc, zoom);
  return {
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
 * place. The combined Fit + zoom scale changes, so the offset is recomputed
 * before being clamped.
 */
export function zoomAt(
  doc: DocumentState,
  crop: Crop,
  nextZoom: number,
  point: { x: number; y: number },
): Crop {
  if (!doc.source) return crop;
  const zoom = clampZoom(nextZoom);
  const base = fitScale(doc);
  const before = base * crop.zoom;
  const after = base * zoom;

  // Source fraction under the pointer, using the current draw rectangle.
  const left = doc.frame.width / 2 + crop.offsetX - (doc.source.width * before) / 2;
  const u = (point.x - left) / (doc.source.width * before);

  // Keep that fraction under the same Frame point at the new scale.
  const offsetX = point.x + (0.5 - u) * doc.source.width * after - doc.frame.width / 2;
  const offsetY = (() => {
    const top = doc.frame.height / 2 + crop.offsetY - (doc.source.height * before) / 2;
    const v = (point.y - top) / (doc.source.height * before);
    return point.y + (0.5 - v) * doc.source.height * after - doc.frame.height / 2;
  })();

  return clampCrop(doc, { zoom, offsetX, offsetY });
}

/** The Source draw rectangle inside the Frame at 1×, before output scaling. */
export function sourceRect(doc: DocumentState): { x: number; y: number; width: number; height: number } {
  if (!doc.source) return { x: 0, y: 0, width: 0, height: 0 };
  const scale = effectiveScale(doc);
  const width = doc.source.width * scale;
  const height = doc.source.height * scale;
  return {
    x: doc.frame.width / 2 + doc.crop.offsetX - width / 2,
    y: doc.frame.height / 2 + doc.crop.offsetY - height / 2,
    width,
    height,
  };
}
