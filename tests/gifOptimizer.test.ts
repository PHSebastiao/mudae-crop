import { describe, expect, it } from 'vitest';
import { gifsicleCommand } from '../src/platform/gifOptimizer';

describe('gifsicle command', () => {
  it('matches the ezgif lossy pipeline', () => {
    expect(gifsicleCommand({ lossy: 30, colors: null, level: 3 })).toBe(
      '-O3 --lossy=30 --gamma=1 in.gif -o /out/out.gif',
    );
  });

  it('adds the optional palette cap after the lossy flags', () => {
    expect(gifsicleCommand({ lossy: 100, colors: 64, level: 3 })).toBe(
      '-O3 --lossy=100 --gamma=1 --colors=64 in.gif -o /out/out.gif',
    );
  });
});
