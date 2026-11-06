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
 * Draw the Source at output scale, with its top-left at (originX, originY).
 * Only uniform scaling is ever applied, so the Source can never be distorted.
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
  ctx.drawImage(
    doc.source.image,
    originX + rect.x * scale,
    originY + rect.y * scale,
    rect.width * scale,
    rect.height * scale,
  );
}

/**
 * The single render entry point. Preview calls it at display scale; Export
 * calls it at 1× (and later 2×). Nothing else draws Frame content.
 */
export function renderFrame(
  ctx: RenderContext,
  doc: DocumentState,
  options: RenderOptions,
): void {
  const { scale } = options;
  ctx.clearRect(0, 0, doc.frame.width * scale, doc.frame.height * scale);
  drawSource(ctx, doc, scale);
}
