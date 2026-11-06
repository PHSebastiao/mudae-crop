import type { DocumentState } from './document';
import { sourceRect } from './geometry';

/**
 * The minimal 2D context surface the render seam needs. Both the browser
 * canvas and the test canvas satisfy it.
 */
export interface RenderContext {
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: 'low' | 'medium' | 'high';
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

export interface RenderOptions {
  /** Output scale relative to the Frame: 1 for a 1× Export, display scale for Preview. */
  readonly scale: number;
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
  scale: number,
  originX = 0,
  originY = 0,
): void {
  if (!doc.source) return;
  const rect = sourceRect(doc);
  prepareContext(ctx);

  const x = originX + rect.x * scale;
  const y = originY + rect.y * scale;
  const width = rect.width * scale;
  const height = rect.height * scale;

  if (doc.crop.rotation === 0) {
    ctx.drawImage(doc.source.image, x, y, width, height);
    return;
  }

  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((doc.crop.rotation * Math.PI) / 180);
  ctx.drawImage(
    doc.source.image,
    -(doc.source.width * scale) / 2,
    -(doc.source.height * scale) / 2,
    doc.source.width * scale,
    doc.source.height * scale,
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
  const { scale } = options;
  const width = doc.frame.width * scale;
  const height = doc.frame.height * scale;
  ctx.clearRect(0, 0, width, height);

  // Fit always covers, so it keeps its alpha. Every other mode may leave an
  // uncovered area, and that area is painted with the Pad color.
  if (doc.crop.mode !== 'fit') {
    ctx.fillStyle = doc.padColor;
    ctx.fillRect(0, 0, width, height);
  }

  drawSource(ctx, doc, scale);
}
