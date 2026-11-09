import { normalizeHexColor } from './color';
import { MAX_MEDIA_BYTES } from './limits';
import { MUDAE_RATIO } from './ratios';
import { fitRect, nativeSize } from './rect';
import { MUDAE_SIZE_GUIDANCE_BYTES } from './size';
import { DEFAULT_WAIFU2X, clampWaifu2x, type Waifu2xPatch, type Waifu2xSettings } from './waifu2x';

export { DEFAULT_WAIFU2X, clampWaifu2x } from './waifu2x';
export type {
  Waifu2xDenoise,
  Waifu2xPatch,
  Waifu2xScale,
  Waifu2xSettings,
  Waifu2xStatus,
} from './waifu2x';

export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'apng' | 'mp4' | 'mov' | 'webm';

export type VideoFormat = 'mp4' | 'mov' | 'webm';

export function isVideoFormat(format: ImageFormat): format is VideoFormat {
  return format === 'mp4' || format === 'mov' || format === 'webm';
}

/**
 * A video-backed Source keeps the decoded file alive and draws frames on
 * demand. Preview uses native playback; scrub and Export seek frame by frame.
 */
export interface VideoSource {
  readonly frameCount: number;
  readonly fps: number;
  readonly durationMs: number;
  /** The canvas holding the most recently drawn video frame. */
  readonly image: CanvasImageSource | null;
  readonly currentTimeMs: number;
  seekToFrame(index: number): Promise<void>;
  seekToMs(ms: number): Promise<void>;
  play(rate: number): void;
  pause(): void;
  dispose(): void;
}

export interface AnimationFrame {
  /** A fully composited frame at the Source's dimensions. */
  readonly image: CanvasImageSource;
  readonly delayMs: number;
}

export interface Animation {
  /** Every frame, already composited and ready to draw. */
  readonly frames: readonly AnimationFrame[];
  /**
   * The raw Netscape loop field: 0 loops forever, N repeats N times. Null means
   * the file had no loop extension and plays a single cycle.
   */
  readonly loopCount: number | null;
}

/**
 * A decoded Source. The bitmap is kept as an opaque drawable so the core stays
 * free of browser APIs; the platform layer decides how it is decoded.
 */
export interface Source {
  readonly name: string;
  readonly path: string | null;
  readonly width: number;
  readonly height: number;
  readonly format: ImageFormat;
  /** Byte size of the imported file or download, for the Source readout. */
  readonly bytes: number;
  /** The first frame, used by still Sources and as an animation fallback. */
  readonly image: CanvasImageSource;
  readonly animation?: Animation;
  /** Present for video Sources, which decode frames on demand. */
  readonly video?: VideoSource;
}

/** The inclusive frame range an animation renders and exports. */
export interface Trim {
  readonly start: number;
  readonly end: number;
}

export function isAnimated(source: Source | null | undefined): boolean {
  if (!source) return false;
  if (source.video) return source.video.frameCount > 1;
  return (source.animation?.frames.length ?? 0) > 1;
}

/** Total frames of an animated Source, 0 for a still. */
export function animationFrameCount(source: Source | null | undefined): number {
  if (!source) return 0;
  if (source.video) return source.video.frameCount;
  return source.animation?.frames.length ?? 0;
}

/** The full range of a Source's animation, or null for a still. */
export function initialTrim(source: Source | null | undefined): Trim | null {
  return clampTrim(source, null);
}

/** Keep a Trim inside a frame count and in start ≤ end order. */
function trimWithin(trim: Trim | null, frameCount: number): Trim {
  const last = Math.max(0, frameCount - 1);
  if (!trim) return { start: 0, end: last };
  const first = Math.min(last, Math.max(0, Math.round(trim.start)));
  const second = Math.min(last, Math.max(0, Math.round(trim.end)));
  return { start: Math.min(first, second), end: Math.max(first, second) };
}

/** Keep a Trim inside the Source's frames and in start ≤ end order. */
export function clampTrim(source: Source | null | undefined, trim: Trim | null): Trim | null {
  if (!isAnimated(source)) return null;
  return trimWithin(trim, animationFrameCount(source));
}

/** The number of frames in the active Trim, or 1 for a still. */
export function trimFrameCount(source: Source | null | undefined, trim: Trim | null): number {
  const range = clampTrim(source, trim);
  return range ? range.end - range.start + 1 : 1;
}

/** The drawable frame at an absolute animation index, clamped to the Source. */
export function frameImage(
  source: Source | null | undefined,
  frameIndex = 0,
): CanvasImageSource | null {
  if (!source) return null;
  if (source.video) return source.video.image ?? source.image;
  const frames = source.animation?.frames;
  if (!frames || frames.length === 0) return source.image;
  const index = Math.min(frames.length - 1, Math.max(0, Math.round(frameIndex)));
  return frames[index].image;
}

/** The base delay of an absolute animation index, with a still fallback. */
export function frameDelayMs(source: Source | null | undefined, frameIndex = 0): number {
  if (source?.video) {
    return source.video.fps > 0 ? 1000 / source.video.fps : 100;
  }
  const frames = source?.animation?.frames;
  if (!frames || frames.length === 0) return 100;
  const index = Math.min(frames.length - 1, Math.max(0, Math.round(frameIndex)));
  return frames[index].delayMs;
}

export const MIN_FRAME_DELAY_MS = 20;
/** The GIF format stores delays in centiseconds, so 65535 is the largest value. */
export const MAX_FRAME_DELAY_MS = 655_350;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(speed * 100) / 100));
}

/**
 * One base frame delay after the Speed multiplier and the GIF's 10 ms grid.
 * Preview and Export both read this, so the grid can show the played duration.
 */
export function scaledDelayMs(delayMs: number, speed = 1): number {
  const scaled = delayMs / clampSpeed(speed);
  const rounded = Math.round(scaled / 10) * 10;
  return Math.max(MIN_FRAME_DELAY_MS, rounded);
}

/** The delay the Preview and Export actually use at a given speed. */
export function effectiveDelayMs(
  source: Source | null | undefined,
  frameIndex: number,
  speed = 1,
): number {
  return scaledDelayMs(frameDelayMs(source, frameIndex), speed);
}

/** The Trim that actually applies: the saved range only when enabled. */
export function effectiveTrim(doc: DocumentState): Trim | null {
  const source = effectiveSource(doc);
  if (!isAnimated(source)) return null;
  if (!doc.trimEnabled) return clampTrim(source, null);
  return clampTrim(source, doc.trim);
}

/**
 * The editable animation of an image Source, or null for a still or a video.
 * It starts as the Source's own animation and changes only through the frame
 * grid; replacing the Source rebuilds it.
 */
export function effectiveAnimation(doc: DocumentState): Animation | null {
  if (doc.source?.video) return null;
  return doc.animation ?? doc.source?.animation ?? null;
}

/**
 * The Source with the document's frame edits applied. The imported Source is
 * never changed; deleting and retiming only replace the animation view the
 * Preview, Trim and Export read. A video Source has no editable animation, so
 * it passes through untouched.
 */
export function effectiveSource(doc: DocumentState): Source | null {
  const source = doc.source;
  const animation = effectiveAnimation(doc);
  if (!source || !animation || animation === source.animation) return source;
  return { ...source, animation };
}

/** The Frame's only identity: width / height, always > 0. */
export interface Frame {
  readonly ratio: number;
}

export const DEFAULT_FRAME: Frame = Object.freeze({ ratio: MUDAE_RATIO });

/** A rectangle in the rotated Source's pixel space. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fit covers the Frame, Pad contains it, and the two snaps match one axis.
 * The mode decides the base rect; zoom shrinks it from there.
 */
export type ScaleMode = 'fit' | 'pad' | 'full-width' | 'full-height';

export type Rotation = 0 | 90 | 180 | 270;

const EMPTY_RECT: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/**
 * The Frame window over the rotated Source, in rotated Source pixels. The
 * rect's ratio is the Frame's ratio; zoom and offsets are derived readouts.
 */
export interface Crop {
  readonly mode: ScaleMode;
  readonly rect: Rect;
  readonly rotation: Rotation;
}

export function defaultCrop(mode: ScaleMode = 'fit', rotation: Rotation = 0): Crop {
  return { mode, rect: EMPTY_RECT, rotation };
}

export const FIT_CROP: Crop = Object.freeze(defaultCrop());

export const DEFAULT_PAD_COLOR = '#FFFFFF';

export const MAX_BORDER_WIDTH = 20;
export const MAX_SHARPNESS = 100;

export interface Border {
  readonly color: string;
  readonly width: number;
}

export const DEFAULT_BORDER: Border = Object.freeze({
  color: '#FFFFFF',
  width: 1,
});

export function clampBorderWidth(width: number): number {
  if (!Number.isFinite(width)) return 0;
  return Math.min(MAX_BORDER_WIDTH, Math.max(0, Math.round(width)));
}

export interface ExportResize {
  readonly width: number;
  readonly height: number;
}

export const MIN_EXPORT_SIDE = 1;
export const MAX_EXPORT_SIDE = 4096;

export function clampExportSide(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_EXPORT_SIDE, Math.max(MIN_EXPORT_SIDE, Math.round(value)));
}

export function clampResize(resize: ExportResize): ExportResize {
  return {
    width: clampExportSide(resize.width),
    height: clampExportSide(resize.height),
  };
}

/**
 * Clamp an Export size proportionally: when either side exceeds the largest
 * allowed side, both shrink by the same factor, so the 4096 memory bound can
 * never distort the aspect.
 */
export function clampExportSize(resize: ExportResize): ExportResize {
  const width = Number.isFinite(resize.width)
    ? Math.max(MIN_EXPORT_SIDE, resize.width)
    : MIN_EXPORT_SIDE;
  const height = Number.isFinite(resize.height)
    ? Math.max(MIN_EXPORT_SIDE, resize.height)
    : MIN_EXPORT_SIDE;
  const largest = Math.max(width, height);
  if (largest <= MAX_EXPORT_SIDE) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = MAX_EXPORT_SIDE / largest;
  return {
    width: Math.max(MIN_EXPORT_SIDE, Math.round(width * scale)),
    height: Math.max(MIN_EXPORT_SIDE, Math.round(height * scale)),
  };
}

export interface OptimizeSettings {
  readonly enabled: boolean;
  /** When false, apply the chosen lossy/colour settings without a size goal. */
  readonly targetEnabled: boolean;
  readonly targetBytes: number;
  /** Lossy GIF strength, 0 (off) to 200. */
  readonly lossy: number;
  readonly reduceColors: boolean;
  readonly colors: number;
}

export const MIN_OPTIMIZE_TARGET = 64 * 1024;
export const MAX_OPTIMIZE_TARGET = MAX_MEDIA_BYTES;
export const MIN_LOSSY = 0;
export const MAX_LOSSY = 200;
export const MIN_COLORS = 2;
export const MAX_COLORS = 256;

export const DEFAULT_OPTIMIZE: OptimizeSettings = Object.freeze({
  enabled: false,
  targetEnabled: true,
  targetBytes: MUDAE_SIZE_GUIDANCE_BYTES,
  lossy: 30,
  reduceColors: false,
  colors: 128,
});

export function clampOptimize(patch: Partial<OptimizeSettings>): OptimizeSettings {
  return {
    enabled: patch.enabled ?? DEFAULT_OPTIMIZE.enabled,
    targetEnabled: patch.targetEnabled ?? DEFAULT_OPTIMIZE.targetEnabled,
    targetBytes: Math.min(
      MAX_OPTIMIZE_TARGET,
      Math.max(MIN_OPTIMIZE_TARGET, Math.round(patch.targetBytes ?? DEFAULT_OPTIMIZE.targetBytes)),
    ),
    lossy: Math.min(
      MAX_LOSSY,
      Math.max(MIN_LOSSY, Math.round(patch.lossy ?? DEFAULT_OPTIMIZE.lossy)),
    ),
    reduceColors: patch.reduceColors ?? DEFAULT_OPTIMIZE.reduceColors,
    colors: Math.min(
      MAX_COLORS,
      Math.max(MIN_COLORS, Math.round(patch.colors ?? DEFAULT_OPTIMIZE.colors)),
    ),
  };
}

export interface DocumentState {
  readonly source: Source | null;
  readonly frame: Frame;
  readonly crop: Crop;
  /** Fills the area the Crop leaves uncovered. It starts from the Border color
   * when Pad is first enabled, then stays independent of later Border changes. */
  readonly padColor: string;
  /** True once the user (or the Pad default) chose a Pad color. */
  readonly padColorExplicit: boolean;
  readonly border: Border;
  /** Unsharp-mask strength from 0 (off) to 100. */
  readonly sharpness: number;
  /** A custom Export size; null follows the native crop size. */
  readonly resize: ExportResize | null;
  /** Keeps width and height proportional when the user edits one of them. */
  readonly resizeLocked: boolean;
  /** The saved range of an animated Source; null for a still. */
  readonly trim: Trim | null;
  /**
   * The editable animation the Preview, Trim and Export read. It starts as the
   * Source's own animation and changes only through the frame grid; replacing
   * the Source rebuilds it.
   */
  readonly animation: Animation | null;
  /** Whether the saved Trim applies to Preview and Export. */
  readonly trimEnabled: boolean;
  /** Playback and Export speed, 0.25×–4×. */
  readonly speed: number;
  readonly optimize: OptimizeSettings;
  /** Opt-in waifu2x; off for every fresh document and every new Source. */
  readonly waifu2x: Waifu2xSettings;
}

export function emptyDocument(): DocumentState {
  return {
    source: null,
    frame: DEFAULT_FRAME,
    crop: FIT_CROP,
    padColor: DEFAULT_PAD_COLOR,
    padColorExplicit: false,
    border: DEFAULT_BORDER,
    sharpness: 0,
    resize: null,
    resizeLocked: true,
    trim: null,
    animation: null,
    trimEnabled: false,
    speed: 1,
    optimize: DEFAULT_OPTIMIZE,
    waifu2x: DEFAULT_WAIFU2X,
  };
}

/**
 * Replacing a Source keeps the Frame, Pad color, Border and Export settings
 * while resetting only the Crop and the Trim, so a batch of similar images can
 * be processed quickly.
 */
export function withSource(doc: DocumentState, source: Source): DocumentState {
  return {
    ...doc,
    source,
    crop: {
      mode: 'fit',
      rect: fitRect({ width: source.width, height: source.height }, doc.frame.ratio),
      rotation: 0,
    },
    trim: initialTrim(source),
    animation: source.animation ?? null,
    trimEnabled: false,
    // waifu2x is opt-in per Source: a batch of images never inherits a long
    // render just because the previous one used it.
    waifu2x: DEFAULT_WAIFU2X,
  };
}

export function withTrim(doc: DocumentState, trim: Trim | null): DocumentState {
  return { ...doc, trim: clampTrim(effectiveSource(doc), trim) };
}

export function withTrimEnabled(doc: DocumentState, trimEnabled: boolean): DocumentState {
  if (!isAnimated(effectiveSource(doc))) return { ...doc, trimEnabled: false };
  return { ...doc, trimEnabled };
}

/** A frame delay stays at or above the 20 ms GIF floor and below its ceiling. */
export function clampFrameDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return MIN_FRAME_DELAY_MS;
  return Math.min(MAX_FRAME_DELAY_MS, Math.max(MIN_FRAME_DELAY_MS, Math.round(delayMs)));
}

/** Retime one frame. Preview and Export read the same stored delay. */
export function withFrameDelay(
  doc: DocumentState,
  frameIndex: number,
  delayMs: number,
): DocumentState {
  const animation = effectiveAnimation(doc);
  if (!animation) return doc;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= animation.frames.length) {
    return doc;
  }
  const delay = clampFrameDelayMs(delayMs);
  if (animation.frames[frameIndex].delayMs === delay) return doc;
  const frames = animation.frames.map((frame, index) =>
    index === frameIndex ? { ...frame, delayMs: delay } : frame,
  );
  return { ...doc, animation: { ...animation, frames } };
}

/**
 * Retime one frame in the duration it actually plays at the current Speed.
 * The stored delay is the base the Preview and Export scale from.
 */
export function withFrameEffectiveDelay(
  doc: DocumentState,
  frameIndex: number,
  effectiveMs: number,
): DocumentState {
  return withFrameDelay(doc, frameIndex, effectiveMs * clampSpeed(doc.speed));
}

/**
 * Delete one animation frame. The last remaining frame cannot be removed, so
 * the document always has something to render. Trim bounds move with the
 * deletion and stay inside the shortened animation.
 */
export function withFrameRemoved(doc: DocumentState, frameIndex: number): DocumentState {
  const animation = effectiveAnimation(doc);
  if (!animation || animation.frames.length <= 1) return doc;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= animation.frames.length) {
    return doc;
  }
  const frames = animation.frames.filter((_, index) => index !== frameIndex);
  return {
    ...doc,
    animation: { ...animation, frames },
    trim: trimAfterRemoval(doc.trim, frameIndex, frames.length),
  };
}

/** Shift the Trim so it still names the same frames after one is deleted. */
function trimAfterRemoval(trim: Trim | null, removed: number, frameCount: number): Trim | null {
  if (!trim) return null;
  let start = trim.start;
  let end = trim.end;
  if (removed < start) {
    start -= 1;
    end -= 1;
  } else if (removed <= end) {
    end -= 1;
  }
  // A one-frame Trim that held the deleted frame collapses onto its neighbour
  // instead of swapping into a wider range.
  if (start > end) {
    start = Math.max(0, end);
    end = start;
  }
  return trimWithin({ start, end }, frameCount);
}

export function withSpeed(doc: DocumentState, speed: number): DocumentState {
  const next = clampSpeed(speed);
  return next === doc.speed ? doc : { ...doc, speed: next };
}

/**
 * A custom size always follows the Frame proportion while the lock is on. The
 * height is derived from the width and both sides are capped proportionally, so
 * the 4096 bound never changes the aspect. Unlocked keeps each side as typed
 * (the deliberate stretch escape hatch).
 */
function resizeForFrame(
  resize: ExportResize | null,
  ratio: number,
  locked: boolean,
): ExportResize | null {
  if (!resize) return null;
  if (!locked) return clampResize(resize);
  const width = Number.isFinite(resize.width)
    ? Math.max(MIN_EXPORT_SIDE, resize.width)
    : MIN_EXPORT_SIDE;
  const height = ratio > 0 ? width / ratio : width;
  return clampExportSize({ width, height });
}

export function withResize(doc: DocumentState, resize: ExportResize | null): DocumentState {
  return { ...doc, resize: resizeForFrame(resize, doc.frame.ratio, doc.resizeLocked) };
}

export function withResizeLocked(doc: DocumentState, resizeLocked: boolean): DocumentState {
  return {
    ...doc,
    resizeLocked,
    resize: resizeForFrame(doc.resize, doc.frame.ratio, resizeLocked),
  };
}

export function withOptimize(doc: DocumentState, patch: Partial<OptimizeSettings>): DocumentState {
  return { ...doc, optimize: clampOptimize({ ...doc.optimize, ...patch }) };
}

export function withWaifu2x(doc: DocumentState, patch: Waifu2xPatch): DocumentState {
  const next = clampWaifu2x(patch, doc.waifu2x);
  if (
    next.enabled === doc.waifu2x.enabled &&
    next.denoise === doc.waifu2x.denoise &&
    next.scale === doc.waifu2x.scale
  ) {
    return doc;
  }
  return { ...doc, waifu2x: next };
}

/** The sidecar's upscale: 1 while waifu2x is off, its own scale otherwise. */
export function waifu2xScaleOf(doc: DocumentState): number {
  return doc.waifu2x.enabled ? doc.waifu2x.scale : 1;
}

export function withCrop(doc: DocumentState, crop: Crop): DocumentState {
  return { ...doc, crop };
}

export function withPadColor(doc: DocumentState, padColor: string): DocumentState {
  return {
    ...doc,
    padColor: normalizeHexColor(padColor) ?? doc.padColor,
    padColorExplicit: true,
  };
}

export function withBorder(doc: DocumentState, patch: Partial<Border>): DocumentState {
  const color =
    patch.color !== undefined
      ? (normalizeHexColor(patch.color) ?? doc.border.color)
      : doc.border.color;
  const width = patch.width !== undefined ? clampBorderWidth(patch.width) : doc.border.width;
  if (color === doc.border.color && width === doc.border.width) return doc;
  return { ...doc, border: { color, width } };
}

export function withSharpness(doc: DocumentState, sharpness: number): DocumentState {
  const next = Number.isFinite(sharpness)
    ? Math.min(MAX_SHARPNESS, Math.max(0, Math.round(sharpness)))
    : 0;
  return next === doc.sharpness ? doc : { ...doc, sharpness: next };
}

/**
 * The raster handed to waifu2x and to the normal renderer: the explicit Resize
 * or the native Crop size. When an upscale would exceed the render ceiling the
 * base shrinks first, so the sidecar never produces an unbounded bitmap.
 */
export function baseOutputSize(doc: DocumentState): { width: number; height: number } {
  const requested = doc.resize ?? clampExportSize(nativeSize(doc.crop.rect));
  const scale = waifu2xScaleOf(doc);
  if (scale === 1) return requested;
  const maxBase = Math.max(MIN_EXPORT_SIDE, Math.floor(MAX_EXPORT_SIDE / scale));
  const largest = Math.max(requested.width, requested.height);
  if (largest <= maxBase) return requested;
  // Shrink both sides by the same factor: capping each side on its own would
  // turn a portrait card into a square at 2×/4×.
  const factor = maxBase / largest;
  return clampExportSize({
    width: requested.width * factor,
    height: requested.height * factor,
  });
}

/**
 * The final Export size: the base, multiplied by an active waifu2x scale. At
 * 1× it is the base itself, so turning waifu2x on without upscaling never
 * changes the dimensions.
 */
export function outputSize(doc: DocumentState): { width: number; height: number } {
  const base = baseOutputSize(doc);
  const scale = waifu2xScaleOf(doc);
  if (scale === 1) return base;
  return clampExportSize({
    width: base.width * scale,
    height: base.height * scale,
  });
}
