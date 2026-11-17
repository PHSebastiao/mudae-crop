import { describe, expect, it } from 'vitest';
import {
  IDLE_UPDATE,
  describeProgress,
  describeUpdate,
  normalizeVersion,
  progressPercent,
  shouldOffer,
  type UpdateStatus,
} from '../src/core/update';

function status(phase: UpdateStatus['phase'], version: string | null = null): UpdateStatus {
  return { phase, version, detail: null };
}

describe('update', () => {
  it('starts idle and says so', () => {
    expect(IDLE_UPDATE.phase).toBe('idle');
    expect(describeUpdate(IDLE_UPDATE)).toEqual({ key: 'update.statusIdle' });
  });

  it('names the offered version in the Sobre row', () => {
    expect(describeUpdate(status('available', '0.2.0'))).toEqual({
      key: 'update.statusAvailableVersion',
      params: { version: '0.2.0' },
    });
    expect(describeUpdate(status('available'))).toEqual({ key: 'update.statusAvailable' });
  });

  it('distinguishes a failed check from a failed install', () => {
    expect(describeUpdate(status('failed'))).toEqual({ key: 'update.statusCheckFailed' });
    expect(describeUpdate(status('failed', '0.2.0'))).toEqual({ key: 'update.statusFailed' });
  });

  it('never calls a browser build updated', () => {
    expect(describeUpdate(status('unsupported'))).toEqual({ key: 'update.statusUnsupported' });
  });

  it('keeps a skipped version quiet but lets a newer one through', () => {
    expect(shouldOffer('0.2.0', '0.2.0')).toBe(false);
    expect(shouldOffer('v0.2.0', '0.2.0')).toBe(false);
    expect(shouldOffer('0.3.0', '0.2.0')).toBe(true);
    expect(shouldOffer('0.2.0', '')).toBe(true);
  });

  it('refuses an empty offer instead of prompting for nothing', () => {
    expect(shouldOffer('', '0.2.0')).toBe(false);
    expect(shouldOffer('   ', '')).toBe(false);
  });

  it('normalizes a leading v', () => {
    expect(normalizeVersion(' v0.2.0 ')).toBe('0.2.0');
    expect(normalizeVersion('0.2.0')).toBe('0.2.0');
  });

  it('reports a percentage only when the total is known', () => {
    expect(progressPercent(0, null)).toBeNull();
    expect(progressPercent(0, 0)).toBeNull();
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(500, 200)).toBe(100);
    expect(progressPercent(-5, 200)).toBe(0);
  });

  it('keeps the progress line readable without a total', () => {
    expect(describeProgress(10, null)).toEqual({ key: 'update.statusDownloading' });
    expect(describeProgress(50, 200)).toEqual({
      key: 'update.progressPercent',
      params: { percent: 25 },
    });
  });
});
