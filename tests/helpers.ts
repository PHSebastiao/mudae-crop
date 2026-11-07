import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  DEFAULT_BORDER,
  DEFAULT_PAD_COLOR,
  FIT_CROP,
  MUDAE_FRAME,
  type DocumentState,
  type Source,
} from '../src/core/document';
import { sourceRect } from '../src/core/geometry';
import type { ExportEntry, UploadEntry } from '../src/core/history';
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
  return {
    source,
    frame: MUDAE_FRAME,
    crop: FIT_CROP,
    padColor: DEFAULT_PAD_COLOR,
    padColorExplicit: false,
    border: DEFAULT_BORDER,
    sharpness: 0,
    exportScale: 1,
  };
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

export function makeUploadEntry(
  index: number,
  overrides: Partial<UploadEntry> = {},
): UploadEntry {
  return {
    kind: 'upload',
    link: `https://cdn.imgchest.com/files/image${index}.png`,
    postId: `post${index}`,
    imageId: `image${index}`,
    title: `card ${index} · 225×350`,
    format: 'png',
    size: 1234,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    ...overrides,
  };
}

export function makeExportEntry(
  index: number,
  overrides: Partial<ExportEntry> = {},
): ExportEntry {
  return {
    kind: 'export',
    path: `C:\\Cards\\export${index}.png`,
    fileName: `export${index}.png`,
    title: `card ${index} · 225×350`,
    format: 'png',
    size: 4321,
    width: 225,
    height: 350,
    createdAt: new Date(Date.UTC(2026, 0, 1, 1, index)).toISOString(),
    ...overrides,
  };
}
