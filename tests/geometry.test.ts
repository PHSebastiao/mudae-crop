import { describe, expect, it } from 'vitest';
import {
  FIT_CROP,
  MUDAE_FRAME,
  SQUARE_FRAME,
  defaultCrop,
  withCrop,
} from '../src/core/document';
import {
  clampCrop,
  clampZoom,
  effectiveScale,
  fitScale,
  padScale,
  panBy,
  panLimits,
  resetCrop,
  rotate90,
  rotatedBounds,
  scaleForMode,
  setScaleMode,
  sourceRect,
  zoomAt,
  zoomLimits,
} from '../src/core/geometry';
import { makeDoc, makeSource, sourcePointAt } from './helpers';

describe('scale per mode', () => {
  it('crops a portrait Source to the Fit Frame', () => {
    const doc = makeDoc(makeSource(400, 800));
    expect(fitScale(doc)).toBeCloseTo(225 / 400);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(225);
    expect(rect.height).toBeCloseTo(450);
  });

  it('keeps the whole Source in Pad, leaving bars on both sides', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800)), defaultCrop('pad'));
    expect(padScale(doc)).toBeCloseTo(350 / 800);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(175);
    expect(rect.height).toBeCloseTo(350);
    expect(rect.x).toBeCloseTo((225 - 175) / 2);
    expect(rect.y).toBeCloseTo(0);
  });

  it('snaps to the width in Full width and crops the overflow', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800)), defaultCrop('full-width'));
    expect(scaleForMode(doc)).toBeCloseTo(225 / 400);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(225);
    expect(rect.height).toBeCloseTo(450);
  });

  it('snaps to the height in Full height and leaves bars', () => {
    const doc = withCrop(makeDoc(makeSource(800, 400)), defaultCrop('full-height'));
    expect(scaleForMode(doc)).toBeCloseTo(350 / 400);
    const rect = sourceRect(doc);
    expect(rect.height).toBeCloseTo(350);
    expect(rect.width).toBeCloseTo(700);
    expect(rect.x).toBeCloseTo((225 - 700) / 2);
  });

  it('fills the Square Frame from any Source aspect', () => {
    const doc = { ...makeDoc(makeSource(800, 400)), frame: SQUARE_FRAME };
    expect(fitScale(doc)).toBeCloseTo(350 / 400);
    expect(sourceRect(doc).width).toBeCloseTo(700);
    expect(sourceRect(doc).height).toBeCloseTo(350);
  });

  it('never scales the two axes differently', () => {
    const doc = makeDoc(makeSource(1234, 567));
    const rect = sourceRect(doc);
    expect(rect.width / 1234).toBeCloseTo(rect.height / 567);
    expect(effectiveScale(doc)).toBeCloseTo(rect.width / 1234);
  });
});

describe('rotation', () => {
  it('swaps the bounds of a portrait Source at 90°', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800)), defaultCrop('fit', 90));
    expect(rotatedBounds(doc)).toEqual({ width: 800, height: 400 });
    expect(fitScale(doc)).toBeCloseTo(350 / 400);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(700);
    expect(rect.height).toBeCloseTo(350);
  });

  it('cycles through the four steps back to the original Crop', () => {
    const doc = makeDoc(makeSource(400, 800));
    let crop = doc.crop;
    const steps = [90, 180, 270, 0];
    for (const expected of steps) {
      crop = rotate90(doc, crop);
      expect(crop.rotation).toBe(expected);
    }
    expect(crop).toEqual(FIT_CROP);
  });

  it('keeps a rotated Source centred and unsquashed', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800)), defaultCrop('fit', 90));
    const rect = sourceRect(doc);
    expect(rect.width / 800).toBeCloseTo(rect.height / 400);
    expect(rect.x + rect.width / 2).toBeCloseTo(doc.frame.width / 2);
    expect(rect.y + rect.height / 2).toBeCloseTo(doc.frame.height / 2);
  });
});

describe('zoom', () => {
  it('keeps Fit free of bars, up to eight times Fit', () => {
    const doc = makeDoc(makeSource(400, 800));
    const limits = zoomLimits(doc);
    expect(limits.min).toBeCloseTo(1);
    expect(limits.max).toBeCloseTo(8);
    expect(clampZoom(doc, 0.2)).toBeCloseTo(1);
    expect(clampZoom(doc, 3)).toBeCloseTo(3);
    expect(clampZoom(doc, 99)).toBeCloseTo(8);
    expect(clampZoom(doc, Number.NaN)).toBeCloseTo(1);
  });

  it('clamps between the Pad scale and eight times the Fit scale', () => {
    const source = makeSource(400, 800);
    const doc = withCrop(makeDoc(source), defaultCrop('pad'));
    const limits = zoomLimits(doc);
    expect(limits.min).toBeCloseTo(1);
    expect(limits.max).toBeCloseTo((8 * fitScale(doc)) / padScale(doc));

    const crowded = clampCrop(doc, { ...doc.crop, zoom: 100 });
    expect(effectiveScale({ ...doc, crop: crowded })).toBeCloseTo(8 * fitScale(doc));
    const shrunk = clampCrop(doc, { ...doc.crop, zoom: 0.1 });
    expect(shrunk.zoom).toBeCloseTo(1);
    expect(effectiveScale({ ...doc, crop: shrunk })).toBeCloseTo(padScale(doc));
  });

  it('lets a snap mode shrink only as far as the Pad scale', () => {
    const doc = withCrop(makeDoc(makeSource(800, 400)), defaultCrop('full-height'));
    const limits = zoomLimits(doc);
    expect(limits.min).toBeCloseTo(padScale(doc) / scaleForMode(doc));
    const zoomedOut = clampCrop(doc, { ...doc.crop, zoom: 0.1 });
    expect(zoomedOut.zoom).toBeCloseTo(padScale(doc) / scaleForMode(doc));
    expect(effectiveScale({ ...doc, crop: zoomedOut })).toBeCloseTo(padScale(doc));
  });

  it('keeps the Source point under the pointer while zooming', () => {
    const doc = makeDoc(makeSource(400, 800));
    const point = { x: 90, y: 120 };
    const before = sourcePointAt(doc, point);
    const zoomed = { ...doc, crop: zoomAt(doc, doc.crop, 2.5, point) };
    const after = sourcePointAt(zoomed, point);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('clamps the offset after a zoom near the edge', () => {
    const doc = makeDoc(makeSource(800, 400));
    const crop = zoomAt(doc, FIT_CROP, 2, { x: 0, y: 0 });
    const limits = panLimits({ ...doc, crop });
    expect(crop.offsetX).toBeGreaterThanOrEqual(-limits.x);
    expect(crop.offsetX).toBeLessThanOrEqual(limits.x);
  });
});

describe('pan limits', () => {
  it('allows no vertical pan when Fit already matches the height', () => {
    const doc = makeDoc(makeSource(800, 400));
    expect(panLimits(doc)).toEqual({ x: 237.5, y: 0 });
  });

  it('clamps drags so the Frame stays covered', () => {
    const doc = makeDoc(makeSource(800, 400));
    const panned = panBy(doc, FIT_CROP, 10_000, 10_000);
    expect(panned.offsetX).toBeCloseTo(237.5);
    expect(panned.offsetY).toBe(0);
    expect(clampCrop(doc, { ...FIT_CROP, offsetX: -10_000, offsetY: 0 }).offsetX).toBeCloseTo(
      -237.5,
    );
  });

  it('allows no pan at all when Source and Frame aspect match', () => {
    const doc = makeDoc(makeSource(450, 700));
    expect(panLimits(doc)).toEqual({ x: 0, y: 0 });
    expect(panBy(doc, FIT_CROP, 30, -30)).toEqual(FIT_CROP);
  });

  it('uses the rotated bounds for the pan limits', () => {
    const doc = withCrop(makeDoc(makeSource(800, 400)), defaultCrop('fit', 90));
    expect(panLimits(doc)).toEqual({ x: 0, y: 50 });
  });

  it('does not let a Pad Source drift inside its bars', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800)), defaultCrop('pad'));
    expect(panLimits(doc)).toEqual({ x: 0, y: 0 });
    expect(panBy(doc, doc.crop, 30, -30)).toEqual(doc.crop);
  });
});

describe('mode defaults', () => {
  it('resets zoom and offset when the scale mode changes but keeps rotation', () => {
    const crop = { ...defaultCrop('fit', 90), zoom: 2.5, offsetX: 10, offsetY: -8 };
    expect(setScaleMode(crop, 'pad')).toEqual({
      mode: 'pad',
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 90,
    });
  });

  it('resets zoom, offset and rotation to the mode default', () => {
    const crop = { ...defaultCrop('pad', 180), zoom: 2.5, offsetX: 10, offsetY: -8 };
    expect(resetCrop(crop)).toEqual({
      mode: 'pad',
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
    });
  });

  it('starts from the Mudae Frame', () => {
    expect(makeDoc(null).frame).toEqual(MUDAE_FRAME);
    expect(defaultCrop()).toEqual(FIT_CROP);
  });
});
