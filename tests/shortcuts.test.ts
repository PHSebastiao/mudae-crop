import { describe, expect, it } from 'vitest';
import { MUDAE_RATIO } from '../src/core/ratios';
import { resolveShortcut } from '../src/core/shortcuts';

describe('keyboard shortcuts', () => {
  it('nudges the Crop by one pixel with the arrows', () => {
    expect(resolveShortcut({ key: 'ArrowLeft' })).toEqual({ kind: 'nudge', dx: -1, dy: 0 });
    expect(resolveShortcut({ key: 'ArrowRight' })).toEqual({ kind: 'nudge', dx: 1, dy: 0 });
    expect(resolveShortcut({ key: 'ArrowUp' })).toEqual({ kind: 'nudge', dx: 0, dy: -1 });
    expect(resolveShortcut({ key: 'ArrowDown' })).toEqual({ kind: 'nudge', dx: 0, dy: 1 });
  });

  it('nudges ten pixels with Shift held', () => {
    expect(resolveShortcut({ key: 'ArrowRight', shiftKey: true })).toEqual({
      kind: 'nudge',
      dx: 10,
      dy: 0,
    });
    expect(resolveShortcut({ key: 'ArrowUp', shiftKey: true })).toEqual({
      kind: 'nudge',
      dx: 0,
      dy: -10,
    });
  });

  it('zooms in and out with the plus and minus keys', () => {
    const zoomIn = resolveShortcut({ key: '+' });
    const zoomOut = resolveShortcut({ key: '-' });

    expect(zoomIn?.kind).toBe('zoom');
    expect(zoomOut?.kind).toBe('zoom');
    if (zoomIn?.kind !== 'zoom' || zoomOut?.kind !== 'zoom') return;
    expect(zoomIn.factor).toBeGreaterThan(1);
    expect(zoomOut.factor).toBeLessThan(1);
    expect(zoomIn.factor * zoomOut.factor).toBeCloseTo(1, 6);
  });

  it('accepts the unshifted equals and minus keys a keyboard sends', () => {
    expect(resolveShortcut({ key: '=' })?.kind).toBe('zoom');
    expect(resolveShortcut({ key: '_' })?.kind).toBe('zoom');
  });

  it('rotates the Crop by ninety degrees with R', () => {
    expect(resolveShortcut({ key: 'r' })).toEqual({ kind: 'rotate' });
    expect(resolveShortcut({ key: 'R' })).toEqual({ kind: 'rotate' });
  });

  it('changes the Border width with the bracket keys', () => {
    expect(resolveShortcut({ key: ']' })).toEqual({ kind: 'border', delta: 1 });
    expect(resolveShortcut({ key: '[' })).toEqual({ kind: 'border', delta: -1 });
  });

  it('selects the Mudae and 1:1 presets with 1 and 2', () => {
    expect(resolveShortcut({ key: '1' })).toEqual({ kind: 'preset', ratio: MUDAE_RATIO });
    expect(resolveShortcut({ key: '2' })).toEqual({ kind: 'preset', ratio: 1 });
  });

  it('stays out of text fields and modified shortcuts', () => {
    expect(resolveShortcut({ key: 'ArrowRight' }, { typing: true })).toBeNull();
    expect(resolveShortcut({ key: 'r' }, { typing: true })).toBeNull();
    expect(resolveShortcut({ key: '1', ctrlKey: true })).toBeNull();
    expect(resolveShortcut({ key: ']', metaKey: true })).toBeNull();
    expect(resolveShortcut({ key: 'r', altKey: true })).toBeNull();
    expect(resolveShortcut({ key: 'x' })).toBeNull();
  });
});
