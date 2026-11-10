import { createCanvas, loadImage } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import {
  estimateExportSize,
  renderGif,
  renderPng,
  type ExportAdapter,
  type Waifu2xFrameRunner,
} from '../src/core/export';
import { makeAnimatedSource, makeDoc, makeSource, pngSize, testExportAdapter } from './helpers';
import { withWaifu2x, type DocumentState } from '../src/core/document';
import { Waifu2xError } from '../src/core/waifu2x';

const adapter: ExportAdapter = {
  ...testExportAdapter,
  async decodePng(bytes: Uint8Array): Promise<CanvasImageSource> {
    return (await loadImage(Buffer.from(bytes))) as unknown as CanvasImageSource;
  },
};

/** A stand-in for the sidecar: a box blur at 1× or a nearest re-draw at N×. */
function fakeSidecar(scale: 1 | 2 | 4, onInput?: (bytes: Uint8Array) => void): Waifu2xFrameRunner {
  return async ({ input }) => {
    onInput?.(input);
    const image = await loadImage(Buffer.from(input));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    if (scale === 1) {
      const data = ctx.getImageData(0, 0, image.width, image.height);
      const source = new Uint8ClampedArray(data.data);
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            let sum = 0;
            let count = 0;
            for (let dy = -1; dy <= 1; dy += 1) {
              for (let dx = -1; dx <= 1; dx += 1) {
                const nx = Math.min(image.width - 1, Math.max(0, x + dx));
                const ny = Math.min(image.height - 1, Math.max(0, y + dy));
                sum += source[(ny * image.width + nx) * 4 + channel];
                count += 1;
              }
            }
            data.data[(y * image.width + x) * 4 + channel] = sum / count;
          }
        }
      }
      ctx.putImageData(data, 0, 0);
      return new Uint8Array(canvas.toBuffer('image/png'));
    }

    const scaled = createCanvas(image.width * scale, image.height * scale);
    const scaledCtx = scaled.getContext('2d');
    scaledCtx.imageSmoothingEnabled = false;
    scaledCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    return new Uint8Array(scaled.toBuffer('image/png'));
  };
}

/** Grayscale variance of the pixels inside the Border. */
async function varianceOf(bytes: Uint8Array): Promise<number> {
  const image = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(8, 8, image.width - 16, image.height - 16).data;
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const value = (data[index] + data[index + 1] + data[index + 2]) / 3;
    sum += value;
    squares += value * value;
    count += 1;
  }
  const mean = sum / count;
  return squares / count - mean * mean;
}

function noisySource(width = 225, height = 350) {
  return makeSource(width, height, (ctx) => {
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (x * 7 + y * 13) % 2 === 0 ? 0 : 255;
        const index = (y * width + x) * 4;
        image.data[index] = value;
        image.data[index + 1] = value;
        image.data[index + 2] = value;
        image.data[index + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

function withWaifu2xEnabled(doc: DocumentState, scale: 1 | 2 | 4): DocumentState {
  return withWaifu2x(doc, { enabled: true, denoise: 3, scale });
}

describe('waifu2x PNG Export', () => {
  it('denoises at 1× without changing the dimensions and draws the Border last', async () => {
    const doc = makeDoc(noisySource());
    const plain = await renderPng(doc, adapter);
    const waifu2xDoc = withWaifu2xEnabled(doc, 1);
    const processed = await renderPng(waifu2xDoc, adapter, {
      waifu2x: fakeSidecar(1),
    });

    expect(pngSize(processed)).toEqual({ width: 225, height: 350 });
    expect(await varianceOf(processed)).toBeLessThan((await varianceOf(plain)) * 0.5);
    // The 1px white Border is still the final operation.
    const image = await loadImage(Buffer.from(processed));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    expect(Array.from(ctx.getImageData(0, 0, 1, 1).data)).toEqual([255, 255, 255, 255]);
  });

  it('2× doubles the Export size and hands the base raster to the sidecar', async () => {
    const doc = withWaifu2xEnabled(makeDoc(makeSource(225, 350)), 2);
    const inputs: Uint8Array[] = [];
    const bytes = await renderPng(doc, adapter, {
      waifu2x: fakeSidecar(2, (input) => inputs.push(input)),
    });

    expect(pngSize(bytes)).toEqual({ width: 450, height: 700 });
    expect(inputs).toHaveLength(1);
    expect(pngSize(inputs[0])).toEqual({ width: 225, height: 350 });
  });

  it('4× quadruples the Export size', async () => {
    const doc = withWaifu2xEnabled(makeDoc(makeSource(225, 350)), 4);
    const bytes = await renderPng(doc, adapter, { waifu2x: fakeSidecar(4) });
    expect(pngSize(bytes)).toEqual({ width: 900, height: 1400 });
  });

  it('refuses an enabled waifu2x without a runner', async () => {
    await expect(
      renderPng(withWaifu2xEnabled(makeDoc(makeSource(10, 10)), 1), adapter),
    ).rejects.toMatchObject({ message: 'O waifu2x não está disponível.' });
  });

  it('refuses a transparent sidecar output when the Crop was opaque', async () => {
    const doc = withWaifu2xEnabled(makeDoc(makeSource(225, 350)), 1);
    const transparent = new Uint8Array(createCanvas(225, 350).toBuffer('image/png'));
    const waifu2x: Waifu2xFrameRunner = async () => transparent;

    await expect(renderPng(doc, adapter, { waifu2x })).rejects.toMatchObject({
      message: 'O waifu2x não processou a imagem inteira. Tente exportar de novo.',
    });
  });

  it('turns a non-zero sidecar exit into an Export error', async () => {
    const doc = withWaifu2xEnabled(makeDoc(makeSource(10, 10)), 1);
    const waifu2x: Waifu2xFrameRunner = async () => {
      throw new Waifu2xError('O waifu2x falhou: vkCreateInstance failed');
    };

    await expect(renderPng(doc, adapter, { waifu2x })).rejects.toMatchObject({
      message: 'O waifu2x falhou: vkCreateInstance failed',
    });
  });

  it('estimates the final size without spawning the sidecar', async () => {
    const doc = withWaifu2xEnabled(makeDoc(makeSource(225, 350)), 2);
    const estimate = await estimateExportSize(doc, adapter, { format: 'png' });

    expect(estimate.exact).toBe(false);
    expect(estimate.bytes).toBeGreaterThan(0);
  });
});

describe('waifu2x GIF Export', () => {
  const source = makeAnimatedSource(225, 350, ['#D94F6D', '#2B9C8F', '#23202C'], [100, 100, 100]);

  it('runs once per trimmed frame and reports waifu2x progress', async () => {
    const doc = withWaifu2xEnabled(makeDoc(source), 1);
    const waifu2x = vi.fn(fakeSidecar(1)) as unknown as Waifu2xFrameRunner;
    const progress: { phase: string; done: number; total: number }[] = [];

    const bytes = await renderGif(doc, adapter, {
      waifu2x,
      onProgress: (next) => progress.push(next),
    });

    expect(waifu2x).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([
      { phase: 'waifu2x', done: 1, total: 3 },
      { phase: 'waifu2x', done: 2, total: 3 },
      { phase: 'waifu2x', done: 3, total: 3 },
    ]);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('cancels mid-run and leaves the document untouched', async () => {
    const controller = new AbortController();
    const doc = withWaifu2xEnabled(makeDoc(source), 1);
    const waifu2x: Waifu2xFrameRunner = async () => {
      controller.abort();
      throw new Waifu2xError('cancelado', true);
    };

    const before = doc;
    const attempt = renderGif(doc, adapter, { waifu2x, signal: controller.signal });

    await expect(attempt).rejects.toMatchObject({ cancelled: true });
    expect(doc).toBe(before);
  });

  it('exports the 2× dimensions frame by frame', async () => {
    const doc = withWaifu2xEnabled(makeDoc(source), 2);
    const bytes = await renderGif(doc, adapter, { waifu2x: fakeSidecar(2) });
    const decoded = await loadImage(Buffer.from(bytes));
    expect(decoded.width).toBe(450);
    expect(decoded.height).toBe(700);
  });
});
