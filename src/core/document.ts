import { normalizeHexColor } from './color';

export type ImageFormat = 'png' | 'jpg' | 'gif' | 'webp' | 'apng';

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
}

/** The inclusive frame range an animation renders and exports. */
export interface Trim {
  readonly start: number;
  readonly end: number;
}

export function isAnimated(source: Source | null | undefined): boolean {
  return (source?.animation?.frames.length ?? 0) > 1;
}

/** Total frames of an animated Source, 0 for a still. */
export function animationFrameCount(source: Source | null | undefined): number {
  return source?.animation?.frames.length ?? 0;
}

/** The full range of a Source's animation, or null for a still. */
export function initialTrim(source: Source | null | undefined): Trim | null {
  return clampTrim(source, null);
}

/** Keep a Trim inside the Source's frames and in start ≤ end order. */
export function clampTrim(source: Source | null | undefined, trim: Trim | null): Trim | null {
  if (!isAnimated(source)) return null;
  const last = (source?.animation?.frames.length ?? 1) - 1;
  if (!trim) return { start: 0, end: last };
  const first = Math.min(last, Math.max(0, Math.round(trim.start)));
  const second = Math.min(last, Math.max(0, Math.round(trim.end)));
  return { start: Math.min(first, second), end: Math.max(first, second) };
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
  const frames = source.animation?.frames;
  if (!frames || frames.length === 0) return source.image;
  const index = Math.min(frames.length - 1, Math.max(0, Math.round(frameIndex)));
  return frames[index].image;
}

/** The delay of an absolute animation index, with a sane still fallback. */
export function frameDelayMs(source: Source | null | undefined, frameIndex = 0): number {
  const frames = source?.animation?.frames;
  if (!frames || frames.length === 0) return 100;
  const index = Math.min(frames.length - 1, Math.max(0, Math.round(frameIndex)));
  return frames[index].delayMs;
}

export type FrameId = 'mudae' | 'mudae-landscape' | 'square';

export interface Frame {
  readonly id: FrameId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const MUDAE_FRAME: Frame = Object.freeze({
  id: 'mudae',
  label: 'Mudae 225×350',
  width: 225,
  height: 350,
});

export const MUDAE_LANDSCAPE_FRAME: Frame = Object.freeze({
  id: 'mudae-landscape',
  label: 'Mudae landscape 350×225',
  width: 350,
  height: 225,
});

export const SQUARE_FRAME: Frame = Object.freeze({
  id: 'square',
  label: 'Square 350×350',
  width: 350,
  height: 350,
});

export type Preset = 'mudae' | 'square';
export type Orientation = 'portrait' | 'landscape';

/**
 * Mudae is the portrait card and Square is the profile card. Orientation only
 * has a meaning for Mudae; Square stays 350×350 either way.
 */
export function frameFor(preset: Preset, orientation: Orientation): Frame {
  if (preset === 'square') return SQUARE_FRAME;
  return orientation === 'landscape' ? MUDAE_LANDSCAPE_FRAME : MUDAE_FRAME;
}

export function presetOf(frame: Frame): Preset {
  return frame.id === 'square' ? 'square' : 'mudae';
}

export function orientationOf(frame: Frame): Orientation {
  return frame.id === 'mudae-landscape' ? 'landscape' : 'portrait';
}

/** The same Preset with the Frame swapped between portrait and landscape. */
export function swappedFrame(frame: Frame): Frame {
  return frameFor(presetOf(frame), orientationOf(frame) === 'portrait' ? 'landscape' : 'portrait');
}

/**
 * Fit covers the Frame, Pad contains it, and the two snaps match one axis.
 * The mode decides the base scale; zoom is a multiplier on top of it.
 */
export type ScaleMode = 'fit' | 'pad' | 'full-width' | 'full-height';

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Crop offsets are measured in Frame pixels at 1×, relative to the Source
 * centred in the Frame. Zoom is a multiplier on the mode's scale.
 */
export interface Crop {
  readonly mode: ScaleMode;
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: Rotation;
}

export function defaultCrop(mode: ScaleMode = 'fit', rotation: Rotation = 0): Crop {
  return { mode, zoom: 1, offsetX: 0, offsetY: 0, rotation };
}

export const FIT_CROP: Crop = Object.freeze(defaultCrop());

export type ExportScale = 1 | 2;

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
  readonly exportScale: ExportScale;
  /** The active range of an animated Source; null for a still. */
  readonly trim: Trim | null;
}

export function emptyDocument(): DocumentState {
  return {
    source: null,
    frame: MUDAE_FRAME,
    crop: FIT_CROP,
    padColor: DEFAULT_PAD_COLOR,
    padColorExplicit: false,
    border: DEFAULT_BORDER,
    sharpness: 0,
    exportScale: 1,
    trim: null,
  };
}

/**
 * Replacing a Source keeps the Frame, Pad color, Border and Export settings
 * while resetting only the Crop and the Trim, so a batch of similar images can
 * be processed quickly.
 */
export function withSource(doc: DocumentState, source: Source): DocumentState {
  return { ...doc, source, crop: FIT_CROP, trim: initialTrim(source) };
}

export function withTrim(doc: DocumentState, trim: Trim | null): DocumentState {
  return { ...doc, trim: clampTrim(doc.source, trim) };
}

export function withCrop(doc: DocumentState, crop: Crop): DocumentState {
  return { ...doc, crop };
}

export function withFrame(doc: DocumentState, frame: Frame): DocumentState {
  return { ...doc, frame };
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

export function withExportScale(doc: DocumentState, exportScale: ExportScale): DocumentState {
  return { ...doc, exportScale };
}

export function outputSize(
  doc: DocumentState,
  scale: number = doc.exportScale,
): { width: number; height: number } {
  return {
    width: Math.round(doc.frame.width * scale),
    height: Math.round(doc.frame.height * scale),
  };
}
