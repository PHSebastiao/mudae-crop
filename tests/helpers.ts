import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  FIT_CROP,
  MUDAE_FRAME,
  type DocumentState,
  type Source,
} from '../src/core/document';
import { sourceRect } from '../src/core/geometry';
import type { RenderContext } from '../src/core/render';

export function makeSource(
  width: number,
  height: number,
  paint?: (ctx: SKRSContext2D) => void,
): Source {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (paint) {
    paint(ctx);
  } else {
    ctx.fillStyle = '#3355aa';
    ctx.fillRect(0, 0, width, height);
  }
  return {
    name: 'fixture.png',
    path: null,
    width,
    height,
    format: 'png',
    image: canvas as unknown as CanvasImageSource,
  };
}

export function makeDoc(source: Source | null): DocumentState {
  return { source, frame: MUDAE_FRAME, crop: FIT_CROP };
}

export function contextOf(canvas: Canvas): RenderContext {
  return canvas.getContext('2d') as unknown as RenderContext;
}

/** Source-relative point (0..1) currently drawn under a Frame point. */
export function sourcePointAt(
  doc: DocumentState,
  point: { x: number; y: number },
): { x: number; y: number } {
  if (!doc.source) return { x: 0, y: 0 };
  const rect = sourceRect(doc);
  return { x: (point.x - rect.x) / rect.width, y: (point.y - rect.y) / rect.height };
}

/** Reads the four big-endian dimension bytes from a PNG IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
