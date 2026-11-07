import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  DEFAULT_BORDER,
  DEFAULT_OPTIMIZE,
  DEFAULT_PAD_COLOR,
  FIT_CROP,
  MUDAE_FRAME,
  type DocumentState,
  type Source,
} from '../src/core/document';
import { sourceRect } from '../src/core/geometry';
import type { ExportEntry, UploadEntry } from '../src/core/history';
import type { EncodableCanvas, ExportAdapter } from '../src/core/export';
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
    bytes: 1024,
    image: canvas as unknown as CanvasImageSource,
  };
}

/**
 * A fixture animation: one flat-colour canvas per entry in `colors`, with the
 * given delays (default 100 ms) and Netscape loop count.
 */
export function makeAnimatedSource(
  width: number,
  height: number,
  colors: readonly string[],
  delays?: readonly number[],
  loopCount = 0,
): Source {
  const frames = colors.map((color, index) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return {
      image: canvas as unknown as CanvasImageSource,
      delayMs: delays?.[index] ?? 100,
    };
  });
  return {
    name: 'fixture.gif',
    path: null,
    width,
    height,
    format: 'gif',
    bytes: 2048,
    image: frames[0].image,
    animation: { frames, loopCount },
  };
}

/** A fixture animation whose frames are painted per frame for real texture. */
export function makePaintedAnimation(
  width: number,
  height: number,
  frameCount: number,
  paint: (ctx: SKRSContext2D, frameIndex: number) => void,
  delayMs = 100,
  loopCount = 0,
): Source {
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const canvas = createCanvas(width, height);
    paint(canvas.getContext('2d'), index);
    return {
      image: canvas as unknown as CanvasImageSource,
      delayMs,
    };
  });
  return {
    name: 'painted.gif',
    path: null,
    width,
    height,
    format: 'gif',
    bytes: 4096,
    image: frames[0].image,
    animation: { frames, loopCount },
  };
}

/** The node-canvas Export adapter, shared by the Export and size tests. */
export const testExportAdapter: ExportAdapter = {
  createCanvas(width: number, height: number): EncodableCanvas {
    return createCanvas(width, height) as unknown as EncodableCanvas;
  },
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    return new Uint8Array((canvas as unknown as Canvas).toBuffer('image/png'));
  },
};

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
    resize: null,
    resizeLocked: true,
    trim: source?.animation
      ? { start: 0, end: source.animation.frames.length - 1 }
      : source?.video
        ? { start: 0, end: Math.max(0, source.video.frameCount - 1) }
        : null,
    trimEnabled: false,
    speed: 1,
    optimize: DEFAULT_OPTIMIZE,
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
