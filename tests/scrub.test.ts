import { describe, expect, it } from 'vitest';
import { SCRUB_THRESHOLD, beginScrub, dragIntent, scrubTo } from '../src/core/scrub';

describe('dragIntent', () => {
  it('stays pending until an axis leaves the threshold', () => {
    expect(dragIntent(SCRUB_THRESHOLD - 1, SCRUB_THRESHOLD - 1)).toBe('pending');
  });

  it('drags vertically into a scrub', () => {
    expect(dragIntent(0, SCRUB_THRESHOLD)).toBe('scrub');
    expect(dragIntent(1, -SCRUB_THRESHOLD * 2)).toBe('scrub');
  });

  it('drags sideways into text selection', () => {
    expect(dragIntent(SCRUB_THRESHOLD, 0)).toBe('select');
    expect(dragIntent(-SCRUB_THRESHOLD * 3, 2)).toBe('select');
  });

  it('leaves a diagonal tie pending so the next move decides', () => {
    expect(dragIntent(SCRUB_THRESHOLD, SCRUB_THRESHOLD)).toBe('pending');
  });
});

describe('scrubTo', () => {
  it('stays a click below the threshold', () => {
    const result = scrubTo(beginScrub(100), 1, 100 + SCRUB_THRESHOLD - 1, 0.01);
    expect(result.value).toBeNull();
    expect(result.gesture.active).toBe(false);
  });

  it('activates exactly at the threshold', () => {
    const result = scrubTo(beginScrub(100), 1, 100 - SCRUB_THRESHOLD, 0.01);
    expect(result.gesture.active).toBe(true);
    expect(result.value).toBeCloseTo(1.03);
  });

  it('increases when dragging up and decreases when dragging down', () => {
    const up = scrubTo(beginScrub(100), 10, 90, 1);
    expect(up.value).toBe(20);
    const down = scrubTo(beginScrub(100), 10, 110, 1);
    expect(down.value).toBe(0);
  });

  it('applies the whole distance from the press on the first move', () => {
    const first = scrubTo(beginScrub(100), 0, 80, 0.5);
    expect(first.value).toBe(10);
  });

  it('accumulates one step per pixel after activation', () => {
    const first = scrubTo(beginScrub(100), 0, 96, 2);
    const second = scrubTo(first.gesture, first.value ?? 0, 90, 2);
    expect(second.value).toBe(20);
  });

  it('keeps the value when the step is zero', () => {
    const result = scrubTo(beginScrub(100), 7.5, 40, 0);
    expect(result.value).toBe(7.5);
  });
});
