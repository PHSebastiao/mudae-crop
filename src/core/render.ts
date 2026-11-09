import { effectiveSource, frameImage, type DocumentState } from './document';
import { frameRect, rotatedBounds } from './geometry';
import { applyUnsharpMask } from './sharpen';

/**
 * The minimal 2D context surface the render seam needs. Both the browser
 * canvas and the test canvas satisfy it.
 */
export interface ImageDataLike {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface RenderContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, width: number, height: number): ImageDataLike;
  putImageData(image: ImageDataLike, dx: number, dy: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

/** A Border scaled for Preview: `scale` is preview pixels per export pixel. */
export interface BorderScale {
  readonly scale: number;
  /** Floor so a shrunken Preview Border never disappears. */
  readonly minPx: number;
}

export interface RenderOptions {
  /** The output raster. A resize may stretch it independently on each axis. */
  readonly outputWidth: number;
  readonly outputHeight: number;
  /**
   * `false` skips the Border (Palette sampling and the eyedropper source).
   * Absent draws exactly `doc.border.width` output pixels; a scale keeps a
   * Preview Border visible at any zoom.
   */
  readonly border?: BorderScale | false;
  /** Frame index in the document's animation view; ignored for a still. */
  readonly frameIndex?: number;
}

export function prepareContext(ctx: RenderContext): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

/**
 * Draw the rotated Source so that the crop window's top-left lands at
 * (originX, originY). The axes may scale by different factors only when an
 * unlocked Export deliberately stretches the raster; the Crop itself never
 * distorts the Source. Rotation happens on the canvas transform from
 * the original bitmap, so repeating it never compounds resampling blur.
 */
export function drawSource(
  ctx: RenderContext,
  doc: DocumentState,
  scaleX: number,
  scaleY: number,
  originX = 0,
  originY = 0,
  frameIndex = 0,
): void {
  if (!doc.source) return;
  const image = frameImage(effectiveSource(doc), frameIndex);
  if (!image) return;
  const rect = frameRect(doc);
  const bounds = rotatedBounds(doc);
  const width = bounds.width * scaleX;
  const height = bounds.height * scaleY;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  prepareContext(ctx);

  const x = originX - rect.x * scaleX;
  const y = originY - rect.y * scaleY;

  if (doc.crop.rotation === 0) {
    ctx.drawImage(image, x, y, width, height);
    return;
  }

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((doc.crop.rotation * Math.PI) / 180);
  // Rotating swaps which output axis scales which bitmap axis: the Source's
  // width becomes vertical at 90°/270°. The rotated bitmap still covers the
  // whole rotated bounds, so the crop window lands exactly on its rect.
  const swapped = doc.crop.rotation === 90 || doc.crop.rotation === 270;
  const imageWidth = swapped ? height : width;
  const imageHeight = swapped ? width : height;
  ctx.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
  ctx.restore();
}

/**
 * Fit always covers the Frame; every other Scale mode may leave an uncovered
 * area, which is painted with the Pad color. Preview and Export share this.
 */
export function paintsPadColor(doc: DocumentState): boolean {
  return doc.crop.mode !== 'fit';
}

/**
 * The single render entry point. Preview calls it at the display size; Export
 * calls it at the chosen output size. Nothing else draws Frame content.
 */
export function renderFrame(ctx: RenderContext, doc: DocumentState, options: RenderOptions): void {
  const width = options.outputWidth;
  const height = options.outputHeight;
  const rect = frameRect(doc);
  const scaleX = rect.width > 0 ? width / rect.width : 1;
  const scaleY = rect.height > 0 ? height / rect.height : 1;
  ctx.clearRect(0, 0, width, height);

  if (paintsPadColor(doc)) {
    ctx.fillStyle = doc.padColor;
    ctx.fillRect(0, 0, width, height);
  }

  drawSource(ctx, doc, scaleX, scaleY, 0, 0, options.frameIndex ?? 0);

  // Sharpness runs on the rendered Crop, before the Border is drawn.
  applySharpness(ctx, doc.sharpness, width, height, Math.max(scaleX, scaleY));

  if (options.border !== false && doc.border.width > 0) {
    paintFrameBorder(ctx, doc, width, height, options.border);
  }
}

/**
 * The unsharp mask step, shared by the sync render and by the waifu2x path,
 * which sharpens the sidecar's larger output instead of the base raster.
 */
export function applySharpness(
  ctx: RenderContext,
  amount: number,
  width: number,
  height: number,
  scale = 1,
): void {
  if (amount <= 0) return;
  const pixelsWide = Math.max(1, Math.round(width));
  const pixelsHigh = Math.max(1, Math.round(height));
  const image = ctx.getImageData(0, 0, pixelsWide, pixelsHigh);
  applyUnsharpMask(image.data, image.width, image.height, amount, Math.max(1, Math.round(scale)));
  ctx.putImageData(image, 0, 0);
}

/**
 * The Border stroke for a Preview of a given width, scaled from the final
 * file's pixels and floored to `minPx` canvas pixels. This is the one formula
 * Stage and the renderer share, so the adjust preview cannot drift.
 */
export function frameBorderStroke(
  doc: DocumentState,
  previewWidth: number,
  exportWidth: number,
  minPx = 1,
): number {
  if (doc.border.width <= 0) return 0;
  if (!(previewWidth > 0) || !(exportWidth > 0)) return doc.border.width;
  return Math.max(minPx, doc.border.width * (previewWidth / exportWidth));
}

/**
 * The Border is stroked inside the Frame edge in pixels of the final file. It
 * is drawn after the Source transform is restored, so rotation can never tilt
 * it. A Preview scale keeps it visible at any zoom, but never below one canvas
 * pixel; an Export draws exactly the stored width. waifu2x upscales the crop
 * before this runs, so the Border must be painted on the final raster.
 */
export function paintFrameBorder(
  ctx: RenderContext,
  doc: DocumentState,
  width: number,
  height: number,
  preview?: BorderScale,
): void {
  const stroke =
    preview === undefined
      ? doc.border.width
      : frameBorderStroke(doc, width, width / preview.scale, preview.minPx);
  const inset = stroke / 2;
  ctx.save();
  ctx.strokeStyle = doc.border.color;
  ctx.lineWidth = stroke;
  ctx.strokeRect(inset, inset, width - stroke, height - stroke);
  ctx.restore();
}
