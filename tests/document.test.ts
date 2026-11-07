import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAD_COLOR,
  FIT_CROP,
  MUDAE_FRAME,
  MUDAE_LANDSCAPE_FRAME,
  SQUARE_FRAME,
  emptyDocument,
  frameFor,
  orientationOf,
  outputSize,
  presetOf,
  swappedFrame,
  withBorder,
  withCrop,
  withExportScale,
  withFrame,
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
import { makeAnimatedSource, makeDoc, makeSource } from './helpers';

describe('document', () => {
  it('starts empty with the Mudae frame, a Fit crop and a 1× Export', () => {
    const doc = emptyDocument();
    expect(doc.source).toBeNull();
    expect(doc.frame).toEqual(MUDAE_FRAME);
    expect(doc.crop).toEqual(FIT_CROP);
    expect(doc.padColor).toBe(DEFAULT_PAD_COLOR);
    expect(doc.padColorExplicit).toBe(false);
    expect(doc.border).toEqual({ color: '#FFFFFF', width: 1 });
    expect(doc.sharpness).toBe(0);
    expect(doc.exportScale).toBe(1);
  });

  it('keeps every setting outside the Crop when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const settings = withExportScale(
      withPadColor(
        withFrame(
          withCrop(makeDoc(first), { mode: 'pad', zoom: 3, offsetX: 40, offsetY: -20, rotation: 90 }),
          MUDAE_LANDSCAPE_FRAME,
        ),
        '#123456',
      ),
      2,
    );

    const replaced = withSource(settings, makeSource(800, 400));

    expect(replaced.source).not.toBe(first);
    expect(replaced.frame).toEqual(MUDAE_LANDSCAPE_FRAME);
    expect(replaced.padColor).toBe('#123456');
    expect(replaced.exportScale).toBe(2);
    expect(replaced.crop).toEqual(FIT_CROP);
  });

  it('keeps Border, sharpness and Pad choices when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const settings = withSharpness(
      withPadColor(
        withBorder(
          withFrame(
            withCrop(makeDoc(first), {
              mode: 'pad',
              zoom: 3,
              offsetX: 40,
              offsetY: -20,
              rotation: 90,
            }),
            MUDAE_LANDSCAPE_FRAME,
          ),
          { color: '#FFCC00', width: 2 },
        ),
        '#123456',
      ),
      40,
    );

    const replaced = withSource(settings, makeSource(800, 400));

    expect(replaced.source).not.toBe(first);
    expect(replaced.frame).toEqual(MUDAE_LANDSCAPE_FRAME);
    expect(replaced.padColor).toBe('#123456');
    expect(replaced.padColorExplicit).toBe(true);
    expect(replaced.border).toEqual({ color: '#FFCC00', width: 2 });
    expect(replaced.sharpness).toBe(40);
    expect(replaced.crop).toEqual(FIT_CROP);
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

describe('Frame presets', () => {
  it('gives each Preset and orientation its exact Frame', () => {
    expect(frameFor('mudae', 'portrait')).toEqual({
      id: 'mudae',
      label: 'Mudae 225×350',
      width: 225,
      height: 350,
    });
    expect(frameFor('mudae', 'landscape')).toEqual({
      id: 'mudae-landscape',
      label: 'Mudae landscape 350×225',
      width: 350,
      height: 225,
    });
    expect(frameFor('square', 'portrait')).toEqual({
      id: 'square',
      label: 'Square 350×350',
      width: 350,
      height: 350,
    });
  });

  it('keeps Square square when the orientation is swapped', () => {
    expect(frameFor('square', 'landscape')).toBe(SQUARE_FRAME);
    expect(swappedFrame(SQUARE_FRAME)).toBe(SQUARE_FRAME);
  });

  it('reads the Preset and orientation back from the Frame', () => {
    expect(presetOf(MUDAE_FRAME)).toBe('mudae');
    expect(presetOf(SQUARE_FRAME)).toBe('square');
    expect(orientationOf(MUDAE_FRAME)).toBe('portrait');
    expect(orientationOf(MUDAE_LANDSCAPE_FRAME)).toBe('landscape');
    expect(swappedFrame(MUDAE_FRAME)).toBe(MUDAE_LANDSCAPE_FRAME);
    expect(swappedFrame(MUDAE_LANDSCAPE_FRAME)).toBe(MUDAE_FRAME);
  });
});

describe('export size', () => {
  it('doubles both axes for a 2× Export', () => {
    const doc = withExportScale(makeDoc(makeSource(450, 700)), 2);
    expect(outputSize(doc)).toEqual({ width: 450, height: 700 });

    const square = withExportScale(
      { ...makeDoc(makeSource(450, 700)), frame: SQUARE_FRAME },
      2,
    );
    expect(outputSize(square)).toEqual({ width: 700, height: 700 });
  });

  it('uses the document Export scale when there is no custom size', () => {
    const doc = makeDoc(makeSource(450, 700));
    expect(outputSize(doc)).toEqual({ width: 225, height: 350 });
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
    expect(doc.optimize.lossy).toBe(40);
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

  it('keeps a custom size proportional while the lock is on', () => {
    const doc = makeDoc(makeSource(225, 350));
    const locked = withResize(doc, { width: 400, height: 200 });
    expect(locked.resize).toEqual({ width: 400, height: 622 });
    expect(outputSize(locked)).toEqual({ width: 400, height: 622 });

    const free = withResize(withResizeLocked(doc, false), { width: 400, height: 200 });
    expect(free.resize).toEqual({ width: 400, height: 200 });
    expect(outputSize(free)).toEqual({ width: 400, height: 200 });

    expect(withExportScale(locked, 2).resize).toBeNull();
  });

  it('follows the Frame aspect when the Frame changes while locked', () => {
    const doc = withResize(makeDoc(makeSource(225, 350)), { width: 400, height: 622 });
    const square = withFrame(doc, SQUARE_FRAME);
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
