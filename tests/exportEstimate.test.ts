import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIMIZE,
  withExportScale,
  withResize,
  withTrim,
  withTrimEnabled,
  type DocumentState,
  type Source,
} from '../src/core/document';
import { ExportError, estimateExportSize, renderGif, renderPng } from '../src/core/export';
import { makeDoc, makePaintedAnimation, makeSource, testExportAdapter as adapter } from './helpers';

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

  it('still measures a large still instead of skipping the readout', async () => {
    const doc = withResize(makeDoc(makeSource(16, 16)), { width: 2000, height: 2000 });

    const estimate = await estimateExportSize(doc, adapter, { format: 'png' });

    expect(estimate.exact).toBe(true);
    expect(estimate.bytes).toBeGreaterThan(0);
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

  it('grows with the Trim and with the Export scale', async () => {
    const source = texturedAnimation(4);
    const short = trimmed(makeDoc(source), 0, 1);
    const long = trimmed(makeDoc(source), 0, 3);

    const shortSize = await estimateExportSize(short, adapter, { format: 'gif' });
    const longSize = await estimateExportSize(long, adapter, { format: 'gif' });
    const doubled = await estimateExportSize(withExportScale(short, 2), adapter, { format: 'gif' });

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

  it('refuses a GIF too large to encode on every edit', async () => {
    const doc = withResize(makeDoc(texturedAnimation(2)), { width: 2000, height: 2000 });

    await expect(estimateExportSize(doc, adapter, { format: 'gif' })).rejects.toBeInstanceOf(
      ExportError,
    );
  });

  it('refuses a still when a GIF was asked for', async () => {
    await expect(
      estimateExportSize(makeDoc(makeSource(10, 10)), adapter, { format: 'gif' }),
    ).rejects.toMatchObject({ message: 'A Source não é animada.' });
  });
});
