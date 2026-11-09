import type { DocumentState, Rect, Rotation, ScaleMode } from './document';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Zoom ceiling shared by the Fit and Pad limits. */
export const MAX_ZOOM = 8;

/** Margin around the Frame inside the stage, in CSS pixels. */
export const STAGE_PAD = 84;

/** The adjust phase never magnifies a tiny Source beyond this. */
export const MAX_STAGE_SCALE = 2;

/** The eight edges and corners of the Frame window. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The Source's size after its 90°/270° axes swap. */
export function rotatedSize(source: Size | null, rotation: Rotation): Size {
  if (!source) return { width: 0, height: 0 };
  return rotation === 90 || rotation === 270
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height };
}

function centredRect(bounds: Size, width: number, height: number): Rect {
  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

/** Largest rect of `ratio` inside `bounds`, centred. Fit at zoom 1. */
export function fitRect(bounds: Size, ratio: number): Rect {
  if (bounds.width <= 0 || bounds.height <= 0 || ratio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.min(bounds.width, bounds.height * ratio);
  return centredRect(bounds, width, width / ratio);
}

/** Smallest rect of `ratio` containing `bounds`, centred. Pad at zoom 1. */
export function padRect(bounds: Size, ratio: number): Rect {
  if (bounds.width <= 0 || bounds.height <= 0 || ratio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const width = Math.max(bounds.width, bounds.height * ratio);
  return centredRect(bounds, width, width / ratio);
}

/** The rect matches the Source width and derives its height from the ratio. */
export function fullWidthRect(bounds: Size, ratio: number): Rect {
  if (bounds.width <= 0 || ratio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return centredRect(bounds, bounds.width, bounds.width / ratio);
}

/** The rect matches the Source height and derives its width from the ratio. */
export function fullHeightRect(bounds: Size, ratio: number): Rect {
  if (bounds.height <= 0 || ratio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return centredRect(bounds, bounds.height * ratio, bounds.height);
}

/** The mode's rect at zoom 1. */
export function baseRect(bounds: Size, ratio: number, mode: ScaleMode): Rect {
  switch (mode) {
    case 'pad':
      return padRect(bounds, ratio);
    case 'full-width':
      return fullWidthRect(bounds, ratio);
    case 'full-height':
      return fullHeightRect(bounds, ratio);
    case 'fit':
    default:
      return fitRect(bounds, ratio);
  }
}

/** The scene a crop window needs: the Source, or its union with the window. */
export interface StageView {
  readonly originX: number;
  readonly originY: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
}

/**
 * The stage view over a rotated Source. Outside the adjust phase the Frame is
 * the view; inside it the view must contain both the Source and the window, so
 * a Pad window larger than the Source still shows the whole Frame.
 */
export function stageView(bounds: Size, rect: Rect, adjusting: boolean): StageView {
  const originX = adjusting ? Math.min(0, rect.x) : 0;
  const originY = adjusting ? Math.min(0, rect.y) : 0;
  return {
    originX,
    originY,
    viewWidth: adjusting ? Math.max(bounds.width, rect.x + rect.width) - originX : rect.width,
    viewHeight: adjusting ? Math.max(bounds.height, rect.y + rect.height) - originY : rect.height,
  };
}

/** Where the Frame canvas and the stage scene sit, in CSS and device pixels. */
export interface StageLayout {
  readonly adjusting: boolean;
  readonly view: StageView;
  /** Rotated Source pixels to CSS pixels. */
  readonly scale: number;
  readonly frameLeft: number;
  readonly frameTop: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly sceneWidth: number;
  readonly sceneHeight: number;
  readonly framePixelWidth: number;
  readonly framePixelHeight: number;
  readonly scenePixelWidth: number;
  readonly scenePixelHeight: number;
}

/**
 * Lay out the stage: the Frame box, the scene around it and their backing
 * canvases. Outside the adjust phase the Frame is the view and fills the stage;
 * while adjusting the whole Source is the view and the Frame can move over it.
 * Sizes snap to whole device pixels so the browser never resamples the canvas.
 */
export function stageLayout(
  doc: DocumentState,
  stageSize: Size,
  dpr: number,
  adjusting: boolean,
): StageLayout {
  const rect = doc.crop.rect;
  const hasFrame = doc.source !== null && rect.width > 0 && rect.height > 0;
  const pixelRatio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const availableWidth = Math.max(0, stageSize.width - STAGE_PAD * 2);
  const availableHeight = Math.max(0, stageSize.height - STAGE_PAD * 2);
  const active = adjusting && doc.source !== null;
  const bounds = rotatedSize(doc.source, doc.crop.rotation);
  const view = stageView(bounds, rect, active);
  const naturalScale =
    hasFrame &&
    availableWidth > 0 &&
    availableHeight > 0 &&
    view.viewWidth > 0 &&
    view.viewHeight > 0
      ? Math.min(availableWidth / view.viewWidth, availableHeight / view.viewHeight)
      : 0;
  // Outside the adjust phase the Frame fills the stage at every zoom, so the
  // preview never shrinks as the user zooms in. In the adjust phase the cap
  // avoids magnifying a tiny Source absurdly while the whole Source is shown.
  const scale = active ? Math.min(naturalScale, MAX_STAGE_SCALE) : naturalScale;
  const empty = fitRect({ width: availableWidth, height: availableHeight }, doc.frame.ratio);
  const align = (value: number) => Math.round(value * pixelRatio) / pixelRatio;
  const frameWidth = hasFrame ? align(rect.width * scale) : empty.width;
  const frameHeight = hasFrame ? align(rect.height * scale) : empty.height;
  const sceneWidth = (active ? align(view.viewWidth * scale) : frameWidth) + STAGE_PAD * 2;
  const sceneHeight = (active ? align(view.viewHeight * scale) : frameHeight) + STAGE_PAD * 2;

  return {
    adjusting: active,
    view,
    scale,
    frameLeft: active ? STAGE_PAD + (rect.x - view.originX) * scale : STAGE_PAD,
    frameTop: active ? STAGE_PAD + (rect.y - view.originY) * scale : STAGE_PAD,
    frameWidth,
    frameHeight,
    sceneWidth,
    sceneHeight,
    framePixelWidth: Math.round(frameWidth * pixelRatio),
    framePixelHeight: Math.round(frameHeight * pixelRatio),
    scenePixelWidth: Math.round(sceneWidth * pixelRatio),
    scenePixelHeight: Math.round(sceneHeight * pixelRatio),
  };
}

/** The native pixel size of a rect: its Source pixels, rounded and at least 1. */
export function nativeSize(rect: Rect): Size {
  return {
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

/** The mode's rect at zoom 1 divided by `rect`'s width. */
export function rectZoom(bounds: Size, ratio: number, mode: ScaleMode, rect: Rect): number {
  const base = baseRect(bounds, ratio, mode);
  if (base.width <= 0 || rect.width <= 0) return 1;
  return base.width / rect.width;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function centreRange(size: number, extent: number): { min: number; max: number } {
  return size <= extent
    ? { min: size / 2, max: extent - size / 2 }
    : { min: extent / 2, max: extent / 2 };
}

/** The width limits of a window in a mode: Fit/8 up to the Fit or Pad rect. */
export function rectLimits(
  bounds: Size,
  ratio: number,
  mode: ScaleMode,
): { minWidth: number; maxWidth: number } {
  const cover = fitRect(bounds, ratio);
  const pad = padRect(bounds, ratio);
  return {
    minWidth: cover.width / MAX_ZOOM,
    maxWidth: mode === 'fit' ? cover.width : pad.width,
  };
}

/**
 * Clamp the rect's width to the mode's limits, keep the Frame proportion, keep the
 * centre and clamp the position so the Frame stays over the Source.
 */
export function clampRect(bounds: Size, ratio: number, mode: ScaleMode, rect: Rect): Rect {
  if (bounds.width <= 0 || bounds.height <= 0 || ratio <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const { minWidth, maxWidth } = rectLimits(bounds, ratio, mode);
  if (maxWidth <= 0) return { x: 0, y: 0, width: 0, height: 0 };

  const width = Number.isFinite(rect.width) ? clamp(rect.width, minWidth, maxWidth) : maxWidth;
  const height = width / ratio;
  const xRange = centreRange(width, bounds.width);
  const yRange = centreRange(height, bounds.height);
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;

  return {
    x: clamp(centreX, xRange.min, xRange.max) - width / 2,
    y: clamp(centreY, yRange.min, yRange.max) - height / 2,
    width,
    height,
  };
}

/** Place a rect of `width` × `height` with the handle's opposite edge anchored. */
export function anchoredRect(rect: Rect, handle: Handle, width: number, height: number): Rect {
  const east = handle.includes('e');
  const west = handle.includes('w');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const x = east
    ? rect.x
    : west
      ? rect.x + rect.width - width
      : rect.x + rect.width / 2 - width / 2;
  const y = south
    ? rect.y
    : north
      ? rect.y + rect.height - height
      : rect.y + rect.height / 2 - height / 2;
  return { x, y, width, height };
}

/**
 * Resize `rect` by dragging `handle` by (dx, dy) in rotated Source pixels.
 * Locked keeps the Frame proportion; free returns the new ratio the caller must
 * store on the Frame. The opposite side/corner is anchored.
 */
export function resizeRect(
  bounds: Size,
  ratio: number,
  rect: Rect,
  handle: Handle,
  dx: number,
  dy: number,
  locked: boolean,
  mode: ScaleMode,
): { rect: Rect; ratio: number } {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return { rect, ratio };
  }

  const east = handle.includes('e');
  const west = handle.includes('w');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const horizontal = east || west;
  const vertical = north || south;

  let width = rect.width;
  let height = rect.height;

  if (locked) {
    if (horizontal && vertical) {
      // A corner follows whichever axis moved more relative to its size.
      const widthFromX = east ? rect.width + dx : rect.width - dx;
      const heightFromY = south ? rect.height + dy : rect.height - dy;
      if (Math.abs(dx) / rect.width >= Math.abs(dy) / rect.height) {
        width = widthFromX;
        height = width / ratio;
      } else {
        height = heightFromY;
        width = height * ratio;
      }
    } else if (horizontal) {
      width = east ? rect.width + dx : rect.width - dx;
      height = width / ratio;
    } else {
      height = south ? rect.height + dy : rect.height - dy;
      width = height * ratio;
    }
  } else {
    if (horizontal) width = east ? rect.width + dx : rect.width - dx;
    if (vertical) height = south ? rect.height + dy : rect.height - dy;
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { rect, ratio };
  }

  const nextRatio = locked ? ratio : width / height;
  const placed = anchoredRect(rect, handle, width, height);
  return {
    rect: clampRect(bounds, nextRatio, mode, placed),
    ratio: nextRatio,
  };
}
