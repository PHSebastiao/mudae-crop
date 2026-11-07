import { describe, expect, it } from 'vitest';
import {
  MUDAE_SIZE_GUIDANCE_BYTES,
  aspectMatches,
  exceedsSizeGuidance,
  exceedsSource,
  formatAspect,
} from '../src/core/size';

const frame = { width: 350, height: 225 };

describe('export size helpers', () => {
  it('accepts the screenshot custom size as proportional within tolerance', () => {
    expect(aspectMatches({ width: 1920, height: 1234 }, frame)).toBe(true);
    expect(aspectMatches({ width: 700, height: 450 }, frame)).toBe(true);
  });

  it('detects a stretched output once the ratio drifts', () => {
    expect(aspectMatches({ width: 1920, height: 1080 }, frame)).toBe(false);
    expect(aspectMatches({ width: 400, height: 400 }, frame)).toBe(false);
  });

  it('formats landscape and portrait ratios with a decimal comma', () => {
    expect(formatAspect({ width: 350, height: 225 })).toBe('1,56:1');
    expect(formatAspect({ width: 225, height: 350 })).toBe('1:1,56');
    expect(formatAspect({ width: 350, height: 350 })).toBe('1,00:1');
  });

  it('flags an output that asks for more pixels than the Source has', () => {
    expect(exceedsSource({ width: 1920, height: 1234 }, { width: 2660, height: 1140 })).toBe(true);
    expect(exceedsSource({ width: 700, height: 450 }, { width: 2660, height: 1140 })).toBe(false);
    expect(exceedsSource({ width: 700, height: 450 }, null)).toBe(false);
  });
});

describe('size guidance', () => {
  it('is Mudae\'s 10 MB hint, not the Image Chest upload ceiling', () => {
    expect(MUDAE_SIZE_GUIDANCE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('warns only once the size passes 10 MB', () => {
    expect(exceedsSizeGuidance(MUDAE_SIZE_GUIDANCE_BYTES)).toBe(false);
    expect(exceedsSizeGuidance(MUDAE_SIZE_GUIDANCE_BYTES + 1)).toBe(true);
    expect(exceedsSizeGuidance(MUDAE_SIZE_GUIDANCE_BYTES * 2)).toBe(true);
  });

  it('never warns when there is no size to judge', () => {
    expect(exceedsSizeGuidance(null)).toBe(false);
    expect(exceedsSizeGuidance(undefined)).toBe(false);
    expect(exceedsSizeGuidance(0)).toBe(false);
  });
});
