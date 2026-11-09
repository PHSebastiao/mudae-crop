import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME,
  DEFAULT_PAD_COLOR,
  FIT_CROP,
  MAX_EXPORT_SIDE,
  emptyDocument,
  outputSize,
  withBorder,
  withCrop,
  withOptimize,
  withPadColor,
  withResize,
  withResizeLocked,
  withSharpness,
  withSource,
  withSpeed,
  withTrim,
  withTrimEnabled,
} from '../src/core/document';
import { applyRatio } from '../src/core/geometry';
import { MUDAE_RATIO } from '../src/core/ratios';
import { fitRect } from '../src/core/rect';
import { makeAnimatedSource, makeDoc, makeSource } from './helpers';

describe('document', () => {
  it('starts empty with the Mudae ratio, a Fit crop and a 1× Export', () => {
    const doc = emptyDocument();
    expect(doc.source).toBeNull();
    expect(doc.frame).toEqual(DEFAULT_FRAME);
    expect(doc.frame.ratio).toBe(MUDAE_RATIO);
    expect(doc.crop).toEqual(FIT_CROP);
    expect(doc.crop.rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(doc.padColor).toBe(DEFAULT_PAD_COLOR);
    expect(doc.padColorExplicit).toBe(false);
    expect(doc.border).toEqual({ color: '#FFFFFF', width: 1 });
    expect(doc.sharpness).toBe(0);
  });

  it('keeps every setting outside the Crop when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const settings = withResize(
      withPadColor(
        applyRatio(
          withCrop(makeDoc(first), {
            mode: 'pad',
            rect: { x: 10, y: 20, width: 400, height: 622 },
            rotation: 90,
          }),
          14 / 9,
        ),
        '#123456',
      ),
      { width: 700, height: 450 },
    );

    const replaced = withSource(settings, makeSource(800, 400));

    expect(replaced.source).not.toBe(first);
    expect(replaced.frame.ratio).toBeCloseTo(14 / 9);
    expect(replaced.padColor).toBe('#123456');
    expect(replaced.resize).toEqual({ width: 700, height: 450 });
    expect(replaced.crop).toEqual({
      mode: 'fit',
      rect: fitRect({ width: 800, height: 400 }, 14 / 9),
      rotation: 0,
    });
  });

  it('keeps Border, sharpness and Pad choices when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const settings = withSharpness(
      withPadColor(
        withBorder(
          applyRatio(
            withCrop(makeDoc(first), {
              mode: 'pad',
              rect: { x: 10, y: 20, width: 400, height: 622 },
              rotation: 90,
            }),
            14 / 9,
          ),
          { color: '#FFCC00', width: 2 },
        ),
        '#123456',
      ),
      40,
    );

    const replaced = withSource(settings, makeSource(800, 400));

    expect(replaced.source).not.toBe(first);
    expect(replaced.frame.ratio).toBeCloseTo(14 / 9);
    expect(replaced.padColor).toBe('#123456');
    expect(replaced.padColorExplicit).toBe(true);
    expect(replaced.border).toEqual({ color: '#FFCC00', width: 2 });
    expect(replaced.sharpness).toBe(40);
    expect(replaced.crop).toEqual({
      mode: 'fit',
      rect: fitRect({ width: 800, height: 400 }, 14 / 9),
      rotation: 0,
    });
  });

  it('imports a Source with a Fit rect built from the Frame ratio', () => {
    const doc = withSource(emptyDocument(), makeSource(400, 800));
    const rect = fitRect({ width: 400, height: 800 }, MUDAE_RATIO);

    expect(doc.frame.ratio).toBe(MUDAE_RATIO);
    expect(doc.crop).toEqual({ mode: 'fit', rect, rotation: 0 });
    expect(doc.crop.rect.width).toBeCloseTo(400);
    expect(doc.crop.rect.height).toBeCloseTo(622.22);
  });
});

describe('Border and sharpness', () => {
  it('normalizes the Border color and clamps its width to 0–20', () => {
    const doc = makeDoc(makeSource(225, 350));

    expect(withBorder(doc, { color: '#aabbcc' }).border).toEqual({
      color: '#AABBCC',
      width: 1,
    });
    expect(withBorder(doc, { width: 99 }).border.width).toBe(20);
    expect(withBorder(doc, { width: -3 }).border.width).toBe(0);
    expect(withBorder(doc, { width: 2.6 }).border.width).toBe(3);
    expect(withBorder(doc, { color: 'not-a-color' }).border.color).toBe('#FFFFFF');
  });

  it('keeps the Border color when only the width changes', () => {
    const doc = withBorder(makeDoc(makeSource(225, 350)), { color: '#112233' });

    expect(withBorder(doc, { width: 4 }).border).toEqual({ color: '#112233', width: 4 });
  });

  it('clamps sharpness to 0–100 and rounds it', () => {
    const doc = makeDoc(makeSource(225, 350));

    expect(withSharpness(doc, 140).sharpness).toBe(100);
    expect(withSharpness(doc, -1).sharpness).toBe(0);
    expect(withSharpness(doc, 42.6).sharpness).toBe(43);
    expect(withSharpness(doc, Number.NaN).sharpness).toBe(0);
  });
});

describe('Frame ratio', () => {
  it('stores only the ratio and keeps it when the Source is replaced', () => {
    const doc = applyRatio(makeDoc(makeSource(400, 800)), 16 / 9);
    expect(doc.frame).toEqual({ ratio: 16 / 9 });

    const replaced = withSource(doc, makeSource(800, 400));
    expect(replaced.frame.ratio).toBe(16 / 9);
  });

  it('rejects an invalid ratio instead of storing it', () => {
    const doc = makeDoc(makeSource(400, 800));
    expect(applyRatio(doc, 0)).toBe(doc);
    expect(applyRatio(doc, Number.NaN)).toBe(doc);
    expect(applyRatio(doc, -1)).toBe(doc);
  });
});

describe('export size', () => {
  it('uses the native crop size when no explicit resize is set', () => {
    const doc = makeDoc(makeSource(450, 700));
    expect(outputSize(doc)).toEqual({ width: 450, height: 700 });
  });

  it('caps the native crop size proportionally instead of distorting it', () => {
    const doc = makeDoc(makeSource(3000, 5000));
    const size = outputSize(doc);
    expect(Math.max(size.width, size.height)).toBe(MAX_EXPORT_SIDE);
    expect(size.width / size.height).toBeCloseTo(MUDAE_RATIO, 3);
  });

  it('keeps an explicit resize while the lock derives the other side', () => {
    const doc = withResize(makeDoc(makeSource(450, 700)), { width: 300, height: 1 });
    expect(doc.resize).toEqual({ width: 300, height: 467 });
    expect(outputSize(doc)).toEqual({ width: 300, height: 467 });
  });

  it('caps a locked resize proportionally, preserving the Frame ratio', () => {
    const doc = withResize(makeDoc(makeSource(100, 156)), { width: 6000, height: 1 });
    expect(doc.resize?.height).toBe(MAX_EXPORT_SIDE);
    expect((doc.resize?.width ?? 0) / (doc.resize?.height ?? 1)).toBeCloseTo(MUDAE_RATIO, 2);
  });

  it('clamps each side independently when the lock is deliberately off', () => {
    const free = withResize(withResizeLocked(makeDoc(makeSource(100, 156)), false), {
      width: 6000,
      height: 7000,
    });
    expect(free.resize).toEqual({ width: MAX_EXPORT_SIDE, height: MAX_EXPORT_SIDE });
  });
});

describe('animation editing settings', () => {
  const animated = makeAnimatedSource(10, 10, ['#FF0000', '#00FF00', '#0000FF']);

  it('starts with Trim off, 1× speed, no resize and optimize off', () => {
    const doc = emptyDocument();
    expect(doc.trimEnabled).toBe(false);
    expect(doc.speed).toBe(1);
    expect(doc.resize).toBeNull();
    expect(doc.resizeLocked).toBe(true);
    expect(doc.optimize.enabled).toBe(false);
    expect(doc.optimize.targetEnabled).toBe(true);
    expect(doc.optimize.targetBytes).toBe(10 * 1024 * 1024);
    expect(doc.optimize.lossy).toBe(30);
  });

  it('toggles Trim without losing the saved range', () => {
    const doc = withTrim(withSource(makeDoc(null), animated), { start: 1, end: 2 });
    expect(doc.trimEnabled).toBe(false);
    expect(withTrimEnabled(doc, true).trim).toEqual({ start: 1, end: 2 });
    expect(withTrimEnabled(doc, true).trimEnabled).toBe(true);
    expect(withTrimEnabled(makeDoc(makeSource(10, 10)), true).trimEnabled).toBe(false);
  });

  it('clamps the speed to 0,25×–4× and rounds to two decimals', () => {
    const doc = makeDoc(animated);
    expect(withSpeed(doc, 9).speed).toBe(4);
    expect(withSpeed(doc, 0.1).speed).toBe(0.25);
    expect(withSpeed(doc, 1.234).speed).toBe(1.23);
    expect(withSpeed(doc, Number.NaN).speed).toBe(1);
  });

  it('keeps a custom size proportional to the Frame ratio while the lock is on', () => {
    const doc = makeDoc(makeSource(225, 350));
    const locked = withResize(doc, { width: 400, height: 200 });
    expect(locked.resize).toEqual({ width: 400, height: 622 });
    expect(outputSize(locked)).toEqual({ width: 400, height: 622 });

    const free = withResize(withResizeLocked(doc, false), { width: 400, height: 200 });
    expect(free.resize).toEqual({ width: 400, height: 200 });
    expect(outputSize(free)).toEqual({ width: 400, height: 200 });

    expect(withResize(locked, null).resize).toBeNull();
  });

  it('follows the Frame ratio when it changes while the resize is locked', () => {
    const doc = withResize(makeDoc(makeSource(225, 350)), { width: 400, height: 622 });
    const square = applyRatio(doc, 1);
    expect(square.resize).toEqual({ width: 400, height: 400 });
  });

  it('clamps optimize values and keeps the defaults field by field', () => {
    const doc = withOptimize(makeDoc(makeSource(10, 10)), {
      enabled: true,
      lossy: 999,
      colors: 1,
      targetBytes: 1,
    });
    expect(doc.optimize).toMatchObject({
      enabled: true,
      lossy: 200,
      colors: 2,
      targetBytes: 64 * 1024,
    });
  });
});
