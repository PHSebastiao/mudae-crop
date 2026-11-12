import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIMIZE,
  withResize,
  withTrim,
  withTrimEnabled,
  type DocumentState,
  type Source,
} from '../src/core/document';
import { estimateExportSize, renderGif, renderPng } from '../src/core/export';
import {
  makeDoc,
  makePaintedAnimation,
  makeSource,
  makeVideoFixture,
  testExportAdapter as adapter,
} from './helpers';

const CELL_COLORS = Array.from({ length: 64 }, (_, index) => {
  const r = (index * 40) % 256;
  const g = (index * 90 + 20) % 256;
  const b = (index * 140 + 60) % 256;
  return `rgb(${r}, ${g}, ${b})`;
});

/** Frames with enough per-pixel detail that GIF compression has real work. */
function texturedAnimation(frameCount: number): Source {
  return makePaintedAnimation(225, 350, frameCount, (ctx, frame) => {
    for (let y = 0; y < 350; y += 1) {
      for (let x = 0; x < 225; x += 1) {
        const index = (x * 7 + y * 3 + frame * 13) % CELL_COLORS.length;
        ctx.fillStyle = CELL_COLORS[index];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

function trimmed(doc: DocumentState, start: number, end: number): DocumentState {
  return withTrimEnabled(withTrim(doc, { start, end }), true);
}

describe('estimateExportSize', () => {
  it('measures a still PNG exactly through the real encoder', async () => {
    const source = makeSource(225, 350, (ctx) => {
      ctx.fillStyle = '#D94F6D';
      ctx.fillRect(0, 0, 225, 350);
      ctx.fillStyle = '#2B9C8F';
      ctx.fillRect(0, 0, 100, 100);
    });
    const doc = makeDoc(source);

    const estimate = await estimateExportSize(doc, adapter, { format: 'png' });
    const bytes = await renderPng(doc, adapter, { frameIndex: 0 });

    expect(estimate).toEqual({ bytes: bytes.length, exact: true });
  });

  it('estimates a large still from a reduced raster instead of encoding it whole', async () => {
    const doc = withResize(makeDoc(makeSource(16, 16)), { width: 2000, height: 2000 });

    const estimate = await estimateExportSize(doc, adapter, { format: 'png' });

    expect(estimate.exact).toBe(false);
    expect(estimate.bytes).toBeGreaterThan(0);
  });

  it('keeps a small still exact', async () => {
    const doc = makeDoc(makeSource(900, 1400));

    const estimate = await estimateExportSize(doc, adapter, { format: 'png' });
    const bytes = await renderPng(doc, adapter, { frameIndex: 0 });

    expect(estimate).toEqual({ bytes: bytes.length, exact: true });
  });

  it('encodes the whole GIF when the Trim fits under the sample cap', async () => {
    const doc = trimmed(makeDoc(texturedAnimation(4)), 0, 3);

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif' });
    const bytes = await renderGif(doc, adapter);

    expect(estimate).toEqual({ bytes: bytes.length, exact: true });
  });

  it('extrapolates a long animation from evenly spaced frames', async () => {
    const doc = trimmed(makeDoc(texturedAnimation(12)), 0, 11);

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif' });
    const bytes = await renderGif(doc, adapter);

    expect(estimate.exact).toBe(false);
    expect(Math.abs(estimate.bytes - bytes.length) / bytes.length).toBeLessThan(0.25);
  });

  it('matches the written GIF when the Trim repeats a frame', async () => {
    const held = makePaintedAnimation(60, 60, 4, (ctx, frame) => {
      ctx.fillStyle = frame < 2 ? '#335577' : '#d94f6d';
      ctx.fillRect(0, 0, 60, 60);
    });
    const doc = trimmed(makeDoc(held), 0, 3);

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif' });
    const bytes = await renderGif(doc, adapter);

    expect(estimate).toEqual({ bytes: bytes.length, exact: true });
  });

  it('errs high instead of low when a sampled Trim repeats frames', async () => {
    const held = makePaintedAnimation(60, 60, 12, (ctx, frame) => {
      ctx.fillStyle = frame < 6 ? '#335577' : '#d94f6d';
      ctx.fillRect(0, 0, 60, 60);
    });
    const doc = trimmed(makeDoc(held), 0, 11);

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif' });
    const bytes = await renderGif(doc, adapter);

    // 12 frames exceed the 8-frame sample cap, so the holds are invisible to
    // it; the estimate must stay above the folded file, never below it.
    expect(estimate.exact).toBe(false);
    expect(estimate.bytes).toBeGreaterThanOrEqual(bytes.length);
  });

  it('does not fold a video Trim the estimate cannot seek', async () => {
    const { source } = makeVideoFixture(60, 60, ['#335577', '#d94f6d', '#2B9C8F'], 10);
    const doc = trimmed(makeDoc(source), 0, 2);

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif' });
    const bytes = await renderGif(doc, adapter);

    // Every sampled render is the frame on screen, so folding would collapse
    // the clip into one image; three renders are still three images.
    expect(estimate.exact).toBe(false);
    expect(estimate.bytes / bytes.length).toBeGreaterThan(0.5);
    expect(estimate.bytes / bytes.length).toBeLessThan(1.5);
  });

  it('grows with the Trim and with an explicit bigger Export size', async () => {
    const source = texturedAnimation(4);
    const short = trimmed(makeDoc(source), 0, 1);
    const long = trimmed(makeDoc(source), 0, 3);

    const shortSize = await estimateExportSize(short, adapter, { format: 'gif' });
    const longSize = await estimateExportSize(long, adapter, { format: 'gif' });
    const doubled = await estimateExportSize(
      withResize(short, { width: 450, height: 700 }),
      adapter,
      { format: 'gif' },
    );

    expect(longSize.bytes).toBeGreaterThan(shortSize.bytes);
    expect(doubled.bytes).toBeGreaterThan(shortSize.bytes);
  });

  it('caps the estimate at the Optimize target and stops calling it exact', async () => {
    const doc = trimmed(makeDoc(texturedAnimation(12)), 0, 11);
    const target = 64 * 1024;
    const optimized: DocumentState = {
      ...doc,
      optimize: { ...DEFAULT_OPTIMIZE, enabled: true, targetEnabled: true, targetBytes: target },
    };

    const raw = await estimateExportSize(doc, adapter, { format: 'gif' });
    const estimate = await estimateExportSize(optimized, adapter, { format: 'gif' });

    expect(raw.bytes).toBeGreaterThan(target);
    expect(estimate.bytes).toBe(target);
    expect(estimate.exact).toBe(false);
  });

  it('keeps estimating above the pixel budget by sampling a reduced raster', async () => {
    const doc = withResize(makeDoc(texturedAnimation(2)), { width: 2000, height: 2000 });

    const estimate = await estimateExportSize(doc, adapter, { format: 'gif', maxPixels: 20_000 });

    expect(estimate.exact).toBe(false);
    expect(estimate.bytes).toBeGreaterThan(0);
  });

  it('keeps the sampled canvas within the pixel budget for a small explicit resize', async () => {
    const created: Array<{ width: number; height: number }> = [];
    const recording = {
      createCanvas(width: number, height: number) {
        created.push({ width, height });
        return adapter.createCanvas(width, height);
      },
      encodePng: adapter.encodePng,
    };
    const source = makePaintedAnimation(1200, 1800, 2, (ctx) => {
      ctx.fillStyle = '#335577';
      ctx.fillRect(0, 0, 1200, 1800);
      ctx.fillStyle = '#d94f6d';
      ctx.fillRect(0, 0, 600, 900);
    });
    const doc = withResize(makeDoc(source), { width: 300, height: 450 });

    const estimate = await estimateExportSize(doc, recording, {
      format: 'gif',
      maxPixels: 100_000,
    });

    expect(estimate.exact).toBe(false);
    const largest = created.reduce((area, size) => Math.max(area, size.width * size.height), 0);
    expect(largest).toBeLessThanOrEqual(110_000);
  });

  it('floors the sampled tile to the crop when the crop is tiny', async () => {
    const created: Array<{ width: number; height: number }> = [];
    const recording = {
      createCanvas(width: number, height: number) {
        created.push({ width, height });
        return adapter.createCanvas(width, height);
      },
      encodePng: adapter.encodePng,
    };
    const source = makePaintedAnimation(32, 32, 2, (ctx) => {
      ctx.fillStyle = '#335577';
      ctx.fillRect(0, 0, 32, 32);
    });
    const doc = withResize(makeDoc(source), { width: 4096, height: 4096 });

    const estimate = await estimateExportSize(doc, recording, { format: 'gif' });

    expect(estimate.exact).toBe(false);
    const largest = created.reduce((area, size) => Math.max(area, size.width * size.height), 0);
    // The 64px floor is clamped by the tiny Crop, so the tile is the whole Crop
    // instead of collapsing to a few pixels.
    expect(largest).toBeGreaterThan(600);
    expect(largest).toBeLessThanOrEqual(64 * 64);
  });

  it('runs the sampled path when the pixel budget is forced small', async () => {
    const doc = makeDoc(texturedAnimation(2));

    const exact = await estimateExportSize(doc, adapter, { format: 'gif' });
    const sampled = await estimateExportSize(doc, adapter, { format: 'gif', maxPixels: 10_000 });

    expect(exact.exact).toBe(true);
    expect(sampled.exact).toBe(false);
    expect(sampled.bytes).toBeGreaterThan(exact.bytes);
    expect(sampled.bytes / exact.bytes).toBeLessThan(10);
  });

  it('refuses a still when a GIF was asked for', async () => {
    await expect(
      estimateExportSize(makeDoc(makeSource(10, 10)), adapter, { format: 'gif' }),
    ).rejects.toMatchObject({ message: 'A Source não é animada.' });
  });
});
