import { frameImage, type DocumentState } from './document';
import { sourceRect } from './geometry';
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

export interface RenderOptions {
  /** Output scale relative to the Frame: 1 for a 1× Export, display scale for Preview. */
  readonly scale?: number;
  /** Explicit output raster; overrides the uniform scale, and allows a stretched resize. */
  readonly outputWidth?: number;
  readonly outputHeight?: number;
  /** Palette sampling skips the Border; Preview and Export draw it. */
  readonly border?: boolean;
  /** Absolute frame of an animated Source; ignored for a still. */
  readonly frameIndex?: number;
}

export function prepareContext(ctx: RenderContext): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

/**
 * Draw the Source at output scale, with the top-left of its rotated bounds at
 * (originX, originY). Only uniform scaling is ever applied, so the Source can
 * never be distorted. Rotation happens on the canvas transform from the
 * original bitmap, so repeating it never compounds resampling blur.
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
  const image = frameImage(doc.source, frameIndex);
  if (!image) return;
  const rect = sourceRect(doc);
  prepareContext(ctx);

  const x = originX + rect.x * scaleX;
  const y = originY + rect.y * scaleY;
  const width = rect.width * scaleX;
  const height = rect.height * scaleY;

  if (doc.crop.rotation === 0) {
    ctx.drawImage(image, x, y, width, height);
    return;
  }

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((doc.crop.rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    -(doc.source.width * scaleX) / 2,
    -(doc.source.height * scaleY) / 2,
    doc.source.width * scaleX,
    doc.source.height * scaleY,
  );
  ctx.restore();
}

/**
 * The single render entry point. Preview calls it at display scale; Export
 * calls it at 1× or 2×. Nothing else draws Frame content.
 */
export function renderFrame(
  ctx: RenderContext,
  doc: DocumentState,
  options: RenderOptions,
): void {
  const scale = options.scale ?? 1;
  const width =
    options.outputWidth ?? (options.outputHeight
      ? (options.outputHeight * doc.frame.width) / doc.frame.height
      : doc.frame.width * scale);
  const height =
    options.outputHeight ?? (options.outputWidth
      ? (options.outputWidth * doc.frame.height) / doc.frame.width
      : doc.frame.height * scale);
  const scaleX = width / doc.frame.width;
  const scaleY = height / doc.frame.height;
  ctx.clearRect(0, 0, width, height);

  // Fit always covers, so it keeps its alpha. Every other mode may leave an
  // uncovered area, and that area is painted with the Pad color.
  if (doc.crop.mode !== 'fit') {
    ctx.fillStyle = doc.padColor;
    ctx.fillRect(0, 0, width, height);
  }

  drawSource(ctx, doc, scaleX, scaleY, 0, 0, options.frameIndex ?? 0);

  // Enhancement runs on the rendered Crop, before the Border is drawn.
  if (doc.sharpness > 0) {
    const pixelsWide = Math.max(1, Math.round(width));
    const pixelsHigh = Math.max(1, Math.round(height));
    const image = ctx.getImageData(0, 0, pixelsWide, pixelsHigh);
    applyUnsharpMask(
      image.data,
      image.width,
      image.height,
      doc.sharpness,
      Math.max(1, Math.round(Math.max(scaleX, scaleY))),
    );
    ctx.putImageData(image, 0, 0);
  }

  if (options.border !== false && doc.border.width > 0) {
    drawBorder(ctx, doc, width, height, (scaleX + scaleY) / 2);
  }
}

/**
 * The Border is stroked inside the Frame edge, in Frame pixels at the output
 * scale. It is drawn after the Source transform is restored, so rotation can
 * never tilt it.
 */
function drawBorder(
  ctx: RenderContext,
  doc: DocumentState,
  width: number,
  height: number,
  scale: number,
): void {
  const stroke = doc.border.width * scale;
  const inset = stroke / 2;
  ctx.save();
  ctx.strokeStyle = doc.border.color;
  ctx.lineWidth = stroke;
  ctx.strokeRect(inset, inset, width - stroke, height - stroke);
  ctx.restore();
}
