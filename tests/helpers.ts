import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  FIT_CROP,
  MUDAE_FRAME,
  type DocumentState,
  type Source,
} from '../src/core/document';
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
  const scale =
    Math.max(doc.frame.width / doc.source.width, doc.frame.height / doc.source.height) * doc.crop.zoom;
  const width = doc.source.width * scale;
  const height = doc.source.height * scale;
  const left = doc.frame.width / 2 + doc.crop.offsetX - width / 2;
  const top = doc.frame.height / 2 + doc.crop.offsetY - height / 2;
  return { x: (point.x - left) / width, y: (point.y - top) / height };
}

/** Reads the four big-endian dimension bytes from a PNG IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
