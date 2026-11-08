import { describe, expect, it } from 'vitest';
import {
  effectiveDelayMs,
  frameDelayMs,
  frameImage,
  trimFrameCount,
  withSource,
  withTrim,
} from '../src/core/document';
import {
  formatClock,
  formatDuration,
  formatFps,
  formatPlaybackDuration,
  sampleTrimIndices,
  trimDurationMs,
  trimmedIndices,
} from '../src/core/animation';
import { makeAnimatedSource, makeDoc, makeSource } from './helpers';

describe('Animation trim', () => {
  const source = makeAnimatedSource(
    4,
    4,
    ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'],
    [80, 120, 40, 60],
  );

  it('starts with every frame selected and counts only the trim', () => {
    const doc = withSource(makeDoc(null), source);

    expect(doc.trim).toEqual({ start: 0, end: 3 });
    expect(trimFrameCount(source, doc.trim)).toBe(4);
    expect(trimFrameCount(source, { start: 1, end: 2 })).toBe(2);
  });

  it('keeps the trim inside the Source and in start ≤ end order', () => {
    const doc = withTrim(withSource(makeDoc(null), source), { start: 9, end: -2 });

    expect(doc.trim).toEqual({ start: 0, end: 3 });
    expect(withTrim(doc, { start: 3, end: 1 }).trim).toEqual({ start: 1, end: 3 });
    expect(withTrim(doc, { start: 1, end: 2 }).trim).toEqual({ start: 1, end: 2 });
  });

  it('reports one frame and no trim for a still Source', () => {
    const still = makeSource(10, 10);
    const doc = withSource(makeDoc(null), still);

    expect(doc.trim).toBeNull();
    expect(trimFrameCount(still, null)).toBe(1);
    expect(trimDurationMs(still, null)).toBe(0);
  });

  it('sums the delays of the selected frames', () => {
    expect(trimDurationMs(source, { start: 0, end: 3 })).toBe(300);
    expect(trimDurationMs(source, { start: 1, end: 2 })).toBe(160);
    expect(trimmedIndices(source, { start: 1, end: 2 })).toEqual([1, 2]);
  });

  it('scales delays with the speed multiplier and keeps the 20 ms floor', () => {
    expect(trimDurationMs(source, { start: 0, end: 3 }, 2)).toBe(150);
    expect(trimDurationMs(source, { start: 0, end: 3 }, 0.5)).toBe(600);
    expect(effectiveDelayMs(source, 2, 4)).toBe(20);
    expect(effectiveDelayMs(source, 0, 2)).toBe(40);
  });

  it('samples up to the limit, always keeping the first and last frame', () => {
    const long = makeAnimatedSource(
      2,
      2,
      Array.from({ length: 20 }, () => '#000000'),
    );
    const sampled = sampleTrimIndices(long, { start: 2, end: 19 }, 5);

    expect(sampled).toHaveLength(5);
    expect(sampled[0]).toBe(2);
    expect(sampled[sampled.length - 1]).toBe(19);
    expect(sampled).toEqual([...sampled].sort((a, b) => a - b));
  });

  it('reads the frame image and delay by absolute index', () => {
    expect(frameImage(source, 1)).toBe(source.animation?.frames[1].image);
    expect(frameDelayMs(source, 1)).toBe(120);
    expect(frameDelayMs(source, 99)).toBe(60);
    expect(frameImage(null)).toBeNull();
  });

  it('formats a duration in seconds with a decimal comma', () => {
    expect(formatDuration(0)).toBe('0,0 s');
    expect(formatDuration(1250)).toBe('1,3 s');
  });

  it('formats long durations as minutes and seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_000)).toBe('1:05');
    expect(formatClock(3_661_000)).toBe('61:01');
    expect(formatPlaybackDuration(9_500)).toBe('9,5 s');
    expect(formatPlaybackDuration(65_000)).toBe('1:05');
  });

  it('formats a detected frame rate with a decimal comma only when needed', () => {
    expect(formatFps(30)).toBe('30');
    expect(formatFps(29.97002997)).toBe('29,97');
  });
});
