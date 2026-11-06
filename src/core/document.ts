export type ImageFormat = 'png' | 'jpg' | 'gif';

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
  readonly image: CanvasImageSource;
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

export interface DocumentState {
  readonly source: Source | null;
  readonly frame: Frame;
  readonly crop: Crop;
  /** Fills the area the Crop leaves uncovered, and is never the Border color. */
  readonly padColor: string;
  readonly exportScale: ExportScale;
}

export function emptyDocument(): DocumentState {
  return {
    source: null,
    frame: MUDAE_FRAME,
    crop: FIT_CROP,
    padColor: DEFAULT_PAD_COLOR,
    exportScale: 1,
  };
}

/**
 * Replacing a Source keeps the Frame, Pad color and Export settings while
 * resetting only the Crop, so a batch of similar images can be processed
 * quickly.
 */
export function withSource(doc: DocumentState, source: Source): DocumentState {
  return { ...doc, source, crop: FIT_CROP };
}

export function withCrop(doc: DocumentState, crop: Crop): DocumentState {
  return { ...doc, crop };
}

export function withFrame(doc: DocumentState, frame: Frame): DocumentState {
  return { ...doc, frame };
}

export function withPadColor(doc: DocumentState, padColor: string): DocumentState {
  return { ...doc, padColor };
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
