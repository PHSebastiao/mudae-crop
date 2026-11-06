import { describe, expect, it } from 'vitest';
import { FIT_CROP } from '../src/core/document';
import {
  clampCrop,
  clampZoom,
  effectiveScale,
  fitScale,
  panBy,
  panLimits,
  sourceRect,
  zoomAt,
} from '../src/core/geometry';
import { makeDoc, makeSource, sourcePointAt } from './helpers';

describe('Fit scale', () => {
  it('covers a portrait Frame with a portrait Source', () => {
    const doc = makeDoc(makeSource(400, 800));
    expect(fitScale(doc)).toBeCloseTo(225 / 400);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(225);
    expect(rect.height).toBeCloseTo(450);
  });

  it('covers a portrait Frame with a landscape Source', () => {
    const doc = makeDoc(makeSource(800, 400));
    expect(fitScale(doc)).toBeCloseTo(350 / 400);
    const rect = sourceRect(doc);
    expect(rect.width).toBeCloseTo(700);
    expect(rect.height).toBeCloseTo(350);
  });

  it('never scales the two axes differently', () => {
    const doc = makeDoc(makeSource(1234, 567));
    const rect = sourceRect(doc);
    expect(rect.width / 1234).toBeCloseTo(rect.height / 567);
    expect(effectiveScale(doc)).toBeCloseTo(rect.width / 1234);
  });
});

describe('zoom', () => {
  it('clamps between Fit and eight times Fit', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(99)).toBe(8);
    expect(clampZoom(Number.NaN)).toBe(1);
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
    expect(clampCrop(doc, { zoom: 1, offsetX: -10_000, offsetY: 0 }).offsetX).toBeCloseTo(-237.5);
  });

  it('allows no pan at all when Source and Frame aspect match', () => {
    const doc = makeDoc(makeSource(450, 700));
    expect(panLimits(doc)).toEqual({ x: 0, y: 0 });
    expect(panBy(doc, FIT_CROP, 30, -30)).toEqual(FIT_CROP);
  });
});
