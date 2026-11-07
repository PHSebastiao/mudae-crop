import { describe, expect, it } from 'vitest';
import {
  aspectMatches,
  exceedsSource,
  formatAspect,
  formatScale,
  relativeScale,
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

  it('formats the ratio and the relative scale with a decimal comma', () => {
    expect(formatAspect({ width: 350, height: 225 })).toBe('1,56:1');
    expect(formatAspect({ width: 350, height: 350 })).toBe('1,00:1');
    expect(formatScale(relativeScale({ width: 1920, height: 1234 }, frame))).toBe('5,49×');
    expect(formatScale(relativeScale({ width: 700, height: 450 }, frame))).toBe('2,00×');
  });

  it('flags an output that asks for more pixels than the Source has', () => {
    expect(exceedsSource({ width: 1920, height: 1234 }, { width: 2660, height: 1140 })).toBe(true);
    expect(exceedsSource({ width: 700, height: 450 }, { width: 2660, height: 1140 })).toBe(false);
    expect(exceedsSource({ width: 700, height: 450 }, null)).toBe(false);
  });
});
