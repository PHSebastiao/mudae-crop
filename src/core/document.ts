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

export interface Frame {
  readonly id: 'mudae';
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

/**
 * Crop offsets are measured in Frame pixels at 1×, relative to the Source
 * centred in the Frame. Zoom is a multiplier on the Fit scale.
 */
export interface Crop {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const FIT_CROP: Crop = Object.freeze({ zoom: 1, offsetX: 0, offsetY: 0 });

export interface DocumentState {
  readonly source: Source | null;
  readonly frame: Frame;
  readonly crop: Crop;
}

export function emptyDocument(): DocumentState {
  return { source: null, frame: MUDAE_FRAME, crop: FIT_CROP };
}

/**
 * Replacing a Source keeps the Frame and resets only the Crop, so a batch of
 * similar images can be processed quickly.
 */
export function withSource(doc: DocumentState, source: Source): DocumentState {
  return { ...doc, source, crop: FIT_CROP };
}

export function withCrop(doc: DocumentState, crop: Crop): DocumentState {
  return { ...doc, crop };
}

export function outputSize(doc: DocumentState, scale: number): { width: number; height: number } {
  return {
    width: Math.round(doc.frame.width * scale),
    height: Math.round(doc.frame.height * scale),
  };
}
