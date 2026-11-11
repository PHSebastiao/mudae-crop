import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  DEFAULT_BORDER,
  DEFAULT_FRAME,
  DEFAULT_OPTIMIZE,
  DEFAULT_PAD_COLOR,
  DEFAULT_WAIFU2X,
  type DocumentState,
  type Rotation,
  type ScaleMode,
  type Source,
} from '../src/core/document';
import { MUDAE_RATIO } from '../src/core/ratios';
import { baseRect } from '../src/core/rect';
import type { ExportEntry, UploadEntry } from '../src/core/history';
import type { EncodableCanvas, ExportAdapter } from '../src/core/export';
import { encodeCanvasPng, type PngCanvas } from '../src/core/png';
import { deflateZlib } from '../src/platform/deflate';
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
  // The same encoder and the same deflate the window uses, so a size estimate
  // in a test matches what the app writes.
  encodePng: (canvas: EncodableCanvas): Promise<Uint8Array> =>
    encodeCanvasPng(canvas as unknown as PngCanvas, deflateZlib),
};

export function makeDoc(
  source: Source | null,
  ratio = MUDAE_RATIO,
  mode: ScaleMode = 'fit',
  rotation: Rotation = 0,
): DocumentState {
  const bounds =
    source && (rotation === 90 || rotation === 270)
      ? { width: source.height, height: source.width }
      : source
        ? { width: source.width, height: source.height }
        : { width: 0, height: 0 };
  return {
    source,
    frame: { ...DEFAULT_FRAME, ratio },
    crop: { mode, rect: baseRect(bounds, ratio, mode), rotation },
    padColor: DEFAULT_PAD_COLOR,
    padColorExplicit: false,
    border: DEFAULT_BORDER,
    sharpness: 0,
    resize: null,
    resizeLocked: true,
    trim: source?.animation
      ? { start: 0, end: source.animation.frames.length - 1 }
      : source?.video
        ? { start: 0, end: Math.max(0, source.video.frameCount - 1) }
        : null,
    animation: source?.animation ?? null,
    trimEnabled: false,
    speed: 1,
    optimize: DEFAULT_OPTIMIZE,
    waifu2x: DEFAULT_WAIFU2X,
  };
}

export function contextOf(canvas: Canvas): RenderContext {
  return canvas.getContext('2d') as unknown as RenderContext;
}

/** Reads the four big-endian dimension bytes from a PNG IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * The RGBA pixels of an encoded PNG. Tests compare these instead of file bytes
 * so an assertion about what was drawn cannot depend on the encoder's settings.
 */
export async function pngPixels(bytes: Uint8Array): Promise<Uint8ClampedArray> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height).data;
}

export function makeUploadEntry(index: number, overrides: Partial<UploadEntry> = {}): UploadEntry {
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

export function makeExportEntry(index: number, overrides: Partial<ExportEntry> = {}): ExportEntry {
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
