import { describe, expect, it, vi } from 'vitest';
import { encodeGif } from '../src/core/gif';
import {
  OptimizeCancelledError,
  dropDuplicateFrames,
  optimizeGif,
  type GifOptimizer,
} from '../src/core/optimize';
import type { OptimizeSettings } from '../src/core/document';
import { DEFAULT_OPTIMIZE } from '../src/core/document';
import { buildGif } from './gifFixtures';

const RED: [number, number, number] = [255, 0, 0];

function pixelsOf(width: number, height: number, color = RED): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = color[0];
    pixels[index * 4 + 1] = color[1];
    pixels[index * 4 + 2] = color[2];
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

async function baseGif(): Promise<Uint8Array> {
  return encodeGif([{ pixels: pixelsOf(2, 2), delayMs: 80 }], {
    width: 2,
    height: 2,
    loopCount: 0,
  });
}

function tinyGif(width = 2, height = 2): Uint8Array {
  return buildGif({
    width,
    height,
    frames: [
      {
        width,
        height,
        palette: [RED],
        indices: Array.from({ length: width * height }, () => 0),
      },
    ],
  });
}

function settings(patch: Partial<OptimizeSettings> = {}): OptimizeSettings {
  return { ...DEFAULT_OPTIMIZE, ...patch };
}

describe('dropDuplicateFrames', () => {
  it('merges consecutive identical frames and sums their delays', () => {
    const first = { pixels: pixelsOf(2, 1, [255, 0, 0]), delayMs: 100 };
    const second = { pixels: pixelsOf(2, 1, [255, 0, 0]), delayMs: 50 };
    const third = { pixels: pixelsOf(2, 1, [0, 255, 0]), delayMs: 80 };

    const { frames, dropped } = dropDuplicateFrames([first, second, third]);

    expect(dropped).toBe(1);
    expect(frames).toHaveLength(2);
    expect(frames[0].delayMs).toBe(150);
    expect(frames[1].delayMs).toBe(80);
  });

  it('leaves a sequence without duplicates alone', () => {
    const frames = [
      { pixels: pixelsOf(1, 1, [255, 0, 0]), delayMs: 100 },
      { pixels: pixelsOf(1, 1, [0, 255, 0]), delayMs: 100 },
    ];
    expect(dropDuplicateFrames(frames)).toMatchObject({ dropped: 0 });
  });
});

describe('optimizeGif', () => {
  it('does nothing when lossy compression is off and the target is already met', async () => {
    const base = await baseGif();
    const result = await optimizeGif(base, settings({ lossy: 0, targetBytes: base.length + 1 }), {
      compress: async () => tinyGif(),
    });

    expect(result.attempts).toBe(0);
    expect(result.met).toBe(true);
    expect(result.bytes).toBe(base);
  });

  it('applies the chosen pass even when the base is already under the target', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    const compress = vi.fn(async () => tiny);
    const result = await optimizeGif(base, settings({ lossy: 40, targetBytes: base.length + 1 }), {
      compress,
    });

    expect(compress).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(1);
    expect(result.met).toBe(true);
    expect(result.bytes).toBe(tiny);
    expect(result.baseSize).toBe(base.length);
  });

  it('applies one colour pass under the target when that option is on', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    const compress = vi.fn(async (_bytes: Uint8Array, options: { colors: number | null }) =>
      options.colors === null ? base : tiny,
    );

    const result = await optimizeGif(
      base,
      settings({ targetEnabled: true, targetBytes: base.length + 1, reduceColors: true, colors: 128 }),
      { compress } as GifOptimizer,
    );

    expect(compress).toHaveBeenCalledTimes(2);
    expect(result.colors).toBe(128);
    expect(result.bytes).toBe(tiny);
    expect(result.met).toBe(true);
  });

  it('clears a failed attempt once a later candidate succeeds', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    let calls = 0;
    const compress = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first attempt failed');
      return tiny;
    });

    const result = await optimizeGif(
      base,
      settings({ targetEnabled: true, targetBytes: 1, lossy: 40 }),
      { compress } as GifOptimizer,
    );

    expect(calls).toBeGreaterThan(1);
    expect(result.error).toBeUndefined();
    expect(result.bytes).toBe(tiny);
  });

  it('compresses below the target when the target is turned off', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    const compress = vi.fn(async () => tiny);
    const result = await optimizeGif(
      base,
      settings({ targetEnabled: false, targetBytes: base.length + 1, lossy: 40 }),
      { compress },
    );

    expect(compress).toHaveBeenCalledTimes(1);
    expect(result.targetBytes).toBeNull();
    expect(result.met).toBeNull();
    expect(result.bytes).toBe(tiny);
  });

  it('raises lossy until the target is met', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    const compress = async (
      _bytes: Uint8Array,
      options: { lossy: number; colors: number | null },
    ) => (options.lossy >= 60 ? tiny : base);

    const result = await optimizeGif(
      base,
      settings({ targetBytes: tiny.length + 1, lossy: 40 }),
      { compress } as GifOptimizer,
    );

    expect(result.met).toBe(true);
    expect(result.lossy).toBe(60);
    expect(result.attempts).toBe(2);
    expect(result.size).toBe(tiny.length);
  });

  it('reduces colours as a second pass when enabled', async () => {
    const base = await baseGif();
    const tiny = tinyGif();
    const compress = async (
      _bytes: Uint8Array,
      options: { lossy: number; colors: number | null },
    ) => (options.colors !== null && options.colors <= 32 ? tiny : base);

    const result = await optimizeGif(
      base,
      settings({ targetBytes: tiny.length + 1, lossy: 40, reduceColors: true, colors: 128 }),
      { compress } as GifOptimizer,
    );

    expect(result.met).toBe(true);
    expect(result.colors).toBe(32);
  });

  it('stops after trying every lever when the target cannot be reached', async () => {
    const base = await baseGif();
    const result = await optimizeGif(
      base,
      settings({ targetBytes: 1, lossy: 40 }),
      { compress: async () => base },
    );

    expect(result.met).toBe(false);
    expect(result.bytes).toBe(base);
    expect(result.attempts).toBeGreaterThan(1);
  });

  it('never returns a corrupt or resized candidate', async () => {
    const base = await baseGif();
    const result = await optimizeGif(base, settings({ lossy: 40, targetBytes: 1 }), {
      compress: async () => tinyGif(3, 3),
    });

    expect(result.bytes).toBe(base);
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.error).toContain('inválido');
  });

  it('can be cancelled between attempts', async () => {
    const controller = new AbortController();
    const attempt = optimizeGif(
      await baseGif(),
      settings({ lossy: 40, targetBytes: 1 }),
      { compress: async () => tinyGif() },
      0,
      { signal: controller.signal, onProgress: () => controller.abort() },
    );

    await expect(attempt).rejects.toBeInstanceOf(OptimizeCancelledError);
  });
});
