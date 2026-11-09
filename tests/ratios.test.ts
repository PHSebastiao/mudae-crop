import { describe, expect, it } from 'vitest';
import { MUDAE_RATIO } from '../src/core/ratios';
import {
  RATIO_PRESETS,
  flipRatio,
  matchesRatio,
  mudaeExportSize,
  mudaeScaleOf,
  presetForRatio,
  presetsFor,
  ratioLabel,
  ratioOrientation,
  ratioSlug,
  snapRatio,
} from '../src/core/ratios';

describe('ratio presets', () => {
  it('offers the Mudae, classic and wide families in both orientations', () => {
    const ids = RATIO_PRESETS.map((preset) => preset.id);
    expect(ids).toContain('mudae');
    expect(ids).toContain('mudae-landscape');
    expect(ids).toContain('4x5');
    expect(ids).toContain('5x4');
    expect(ids).toContain('16x9');
    expect(ids).toContain('9x16');
    expect(ids).toContain('21x9');
    expect(ids).toContain('9x21');
    expect(ids).toContain('square');
  });

  it('labels the current orientation and calls a free ratio Personalizado', () => {
    expect(ratioLabel(MUDAE_RATIO)).toBe('Mudae 9:14');
    expect(ratioLabel(1 / MUDAE_RATIO)).toBe('Mudae 14:9');
    expect(ratioLabel(16 / 9)).toBe('16:9');
    expect(ratioLabel(1)).toBe('1:1');
    expect(ratioLabel(1.2)).toBe('Personalizado');
  });

  it('splits portrait, landscape and square', () => {
    expect(ratioOrientation(9 / 14)).toBe('portrait');
    expect(ratioOrientation(16 / 9)).toBe('landscape');
    expect(ratioOrientation(1)).toBe('square');
  });

  it('flips the ratio and leaves 1:1 alone', () => {
    expect(flipRatio(9 / 14)).toBeCloseTo(14 / 9);
    expect(flipRatio(16 / 9)).toBeCloseTo(9 / 16);
    expect(flipRatio(1)).toBe(1);
  });

  it('matches within a tenth of a percent', () => {
    expect(matchesRatio(9 / 14, MUDAE_RATIO)).toBe(true);
    expect(matchesRatio(MUDAE_RATIO * 1.0005, MUDAE_RATIO)).toBe(true);
    expect(matchesRatio(MUDAE_RATIO * 1.004, MUDAE_RATIO)).toBe(false);
    expect(matchesRatio(MUDAE_RATIO * 1.01, MUDAE_RATIO)).toBe(false);
    expect(matchesRatio(0, MUDAE_RATIO)).toBe(false);
  });

  it('lists the orientation presets and every preset for a square Frame', () => {
    const portrait = presetsFor('portrait').map((preset) => preset.id);
    const landscape = presetsFor('landscape').map((preset) => preset.id);
    expect(portrait).toContain('mudae');
    expect(portrait).toContain('4x5');
    expect(portrait).toContain('square');
    expect(portrait).not.toContain('16x9');
    expect(landscape).toContain('16x9');
    expect(landscape).toContain('square');
    expect(landscape).not.toContain('mudae');
    expect(presetsFor('square')).toEqual(RATIO_PRESETS);
  });

  it('snaps a ratio within two and a half percent to the nearest preset', () => {
    expect(snapRatio((16 / 9) * 1.015)?.label).toBe('16:9');
    expect(snapRatio((9 / 16) * 0.985)?.label).toBe('9:16');
    expect(snapRatio(1.02)?.label).toBe('1:1');
    expect(snapRatio(1.04)).toBeNull();
    expect(snapRatio((16 / 9) * 1.03)).toBeNull();
  });

  it('excludes the proportion a drag started on', () => {
    expect(snapRatio((16 / 9) * 1.01, 0.05, 16 / 9)).toBeNull();
    expect(snapRatio(1.5, 0.05, 16 / 9)?.label).toBe('3:2');
  });

  it('honours a tighter tolerance and rejects invalid ratios', () => {
    expect(snapRatio(16 / 9 + 0.05, 0.001)).toBeNull();
    expect(snapRatio(0)).toBeNull();
    expect(snapRatio(Number.NaN)).toBeNull();
  });

  it('identifies a stored preset and rejects a free proportion', () => {
    expect(presetForRatio(MUDAE_RATIO)?.id).toBe('mudae');
    expect(presetForRatio(MUDAE_RATIO * 1.0006)?.ratio).toBe(MUDAE_RATIO);
    expect(presetForRatio(1.2)).toBeNull();
    expect(presetForRatio(0)).toBeNull();
  });

  it('slugs the known families and reduces free ratios', () => {
    expect(ratioSlug(9 / 14)).toBe('mudae');
    expect(ratioSlug(14 / 9)).toBe('mudae-landscape');
    expect(ratioSlug(1)).toBe('square');
    expect(ratioSlug(16 / 9)).toBe('16x9');
    expect(ratioSlug(1.5)).toBe('3x2');
    expect(ratioSlug(1.2)).toBe('6x5');
  });
});

describe('Mudae Export sizes', () => {
  it('offers the canonical portrait and landscape sizes', () => {
    expect(mudaeExportSize(MUDAE_RATIO, 1)).toEqual({ width: 225, height: 350 });
    expect(mudaeExportSize(MUDAE_RATIO, 2)).toEqual({ width: 450, height: 700 });
    expect(mudaeExportSize(14 / 9, 1)).toEqual({ width: 350, height: 225 });
    expect(mudaeExportSize(14 / 9, 2)).toEqual({ width: 700, height: 450 });
  });

  it('returns null for every non-Mudae ratio', () => {
    expect(mudaeExportSize(1, 1)).toBeNull();
    expect(mudaeExportSize(16 / 9, 2)).toBeNull();
  });

  it('recognises which Carta preset an output size is', () => {
    expect(mudaeScaleOf({ width: 225, height: 350 }, MUDAE_RATIO)).toBe(1);
    expect(mudaeScaleOf({ width: 450, height: 700 }, MUDAE_RATIO)).toBe(2);
    expect(mudaeScaleOf({ width: 350, height: 225 }, 14 / 9)).toBe(1);
    expect(mudaeScaleOf({ width: 700, height: 450 }, 14 / 9)).toBe(2);
    expect(mudaeScaleOf({ width: 225, height: 350 }, 14 / 9)).toBeNull();
    expect(mudaeScaleOf({ width: 500, height: 700 }, MUDAE_RATIO)).toBeNull();
  });
});
