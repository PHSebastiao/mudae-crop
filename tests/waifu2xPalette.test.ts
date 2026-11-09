import { createCanvas, loadImage, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_WAIFU2X_PALETTE_FRAMES,
  extractPaletteWithWaifu2x,
  type PaletteAdapter,
  type PaletteColor,
} from '../src/core/palette';
import { contextOf, makeAnimatedSource, makeDoc, makeSource } from './helpers';

function hexes(palette: readonly PaletteColor[]): string[] {
  return palette.map((color) => color.hex);
}

function adapterWithPng(): PaletteAdapter {
  const canvases = new WeakMap<object, Canvas>();
  return {
    createCanvas(width, height) {
      const canvas = createCanvas(width, height);
      const wrapper = { getContext: () => contextOf(canvas) };
      canvases.set(wrapper, canvas);
      return wrapper;
    },
    async encodePng(canvas) {
      return new Uint8Array(canvases.get(canvas)!.toBuffer('image/png'));
    },
  };
}

/** A stand-in sidecar that replaces whatever it receives with one solid color. */
function solidSidecar(color: string, calls?: () => void) {
  return async (png: Uint8Array): Promise<CanvasImageSource> => {
    calls?.();
    const image = await loadImage(Buffer.from(png));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas as unknown as CanvasImageSource;
  };
}

describe('waifu2x Palette', () => {
  it('counts the processed pixels instead of the raw Crop', async () => {
    const source = makeSource(350, 350, (ctx) => {
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 175, 350);
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(175, 0, 175, 350);
    });
    const doc = makeDoc(source, 1);

    const palette = await extractPaletteWithWaifu2x(doc, adapterWithPng(), solidSidecar('#0000FF'));

    expect(hexes(palette)).toContain('#0000FF');
    expect(hexes(palette)).not.toContain('#FF0000');
    expect(hexes(palette)).not.toContain('#00FF00');
  });

  it('runs once for a still and at most six times for an animation', async () => {
    const stillCalls = vi.fn();
    await extractPaletteWithWaifu2x(
      makeDoc(makeSource(100, 100), 1),
      adapterWithPng(),
      solidSidecar('#123456', stillCalls),
    );
    expect(stillCalls).toHaveBeenCalledTimes(1);

    const animationCalls = vi.fn();
    const source = makeAnimatedSource(
      40,
      40,
      Array.from({ length: 20 }, (_, index) => (index % 2 ? '#FF0000' : '#00FF00')),
    );
    await extractPaletteWithWaifu2x(
      makeDoc(source, 1),
      adapterWithPng(),
      solidSidecar('#123456', animationCalls),
    );
    expect(animationCalls).toHaveBeenCalledTimes(MAX_WAIFU2X_PALETTE_FRAMES);
  });

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractPaletteWithWaifu2x(
        makeDoc(makeSource(100, 100), 1),
        adapterWithPng(),
        solidSidecar('#123456'),
        controller.signal,
      ),
    ).rejects.toThrow('Palette cancelada.');
  });

  it('falls back to the raw Crop when the adapter cannot encode a frame', async () => {
    const plainAdapter: PaletteAdapter = {
      createCanvas(width, height) {
        const canvas = createCanvas(width, height);
        return { getContext: () => contextOf(canvas) };
      },
    };

    const palette = await extractPaletteWithWaifu2x(
      makeDoc(makeSource(100, 100), 1),
      plainAdapter,
      solidSidecar('#0000FF'),
    );

    expect(hexes(palette)).not.toContain('#0000FF');
  });
});
