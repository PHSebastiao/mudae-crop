import { describe, expect, it } from 'vitest';
import {
  closeAdjust,
  enterAdjust,
  enterPickPad,
  escape,
  IDLE_STAGE_MODE,
  isAdjusting,
  isPicking,
  leavePick,
  pointerDown,
  pointerUp,
  shouldResumePlayback,
  stageModeOf,
  type StageMode,
} from '../src/core/stageMode';

function adjusting(resumePlayback: boolean): StageMode {
  return { kind: 'adjust', resumePlayback };
}

describe('stage mode exclusivity', () => {
  it('leaves the crop phase when the Pad eyedropper is armed', () => {
    const next = enterPickPad(adjusting(true));
    expect(next.kind).toBe('pick-pad');
    expect(isAdjusting(next)).toBe(false);
    expect(isPicking(next)).toBe(true);
  });

  it('clears the Pad eyedropper when the crop phase is entered', () => {
    const next = enterAdjust({ kind: 'pick-pad' }, false);
    expect(next.kind).toBe('adjust');
    expect(isPicking(next)).toBe(false);
    expect(isAdjusting(next)).toBe(true);
  });

  it('never represents adjust and pick at the same time', () => {
    for (const mode of [IDLE_STAGE_MODE, adjusting(false), { kind: 'pick-pad' } as const]) {
      expect(isAdjusting(enterPickPad(mode)) && isPicking(enterPickPad(mode))).toBe(false);
      expect(isAdjusting(enterAdjust(mode, true)) && isPicking(enterAdjust(mode, true))).toBe(
        false,
      );
    }
  });

  it('leaves pick only from pick and adjust only from adjust', () => {
    expect(leavePick({ kind: 'pick-pad' })).toEqual(IDLE_STAGE_MODE);
    expect(leavePick(adjusting(true))).toEqual(adjusting(true));
    expect(closeAdjust(adjusting(true))).toEqual(IDLE_STAGE_MODE);
    expect(closeAdjust({ kind: 'pick-pad' })).toEqual({ kind: 'pick-pad' });
  });
});

describe('escape', () => {
  it('returns every mode to idle', () => {
    const modes: StageMode[] = [
      IDLE_STAGE_MODE,
      adjusting(true),
      { kind: 'pick-pad' },
      { kind: 'drag', returnTo: { adjust: false, resumePlayback: false } },
      {
        kind: 'resize',
        handle: 'se',
        returnTo: { adjust: true, resumePlayback: true },
      },
    ];
    for (const mode of modes) {
      expect(escape(mode)).toEqual(IDLE_STAGE_MODE);
    }
  });

  it('keeps the idle value when there is nothing to cancel', () => {
    expect(escape(IDLE_STAGE_MODE)).toBe(IDLE_STAGE_MODE);
  });
});

describe('playback resume memory', () => {
  it('remembers playback only when adjust is entered while playing', () => {
    expect(shouldResumePlayback(enterAdjust(IDLE_STAGE_MODE, true))).toBe(true);
    expect(shouldResumePlayback(enterAdjust(IDLE_STAGE_MODE, false))).toBe(false);
  });

  it('resumes only if the phase was entered while playing', () => {
    const playingAtEntry = enterAdjust(IDLE_STAGE_MODE, true);
    expect(shouldResumePlayback(playingAtEntry)).toBe(true);
    expect(closeAdjust(playingAtEntry)).toEqual(IDLE_STAGE_MODE);

    const pausedAtEntry = enterAdjust(IDLE_STAGE_MODE, false);
    expect(shouldResumePlayback(pausedAtEntry)).toBe(false);
    expect(closeAdjust(pausedAtEntry)).toEqual(IDLE_STAGE_MODE);
  });

  it('does not overwrite the memory when adjust is re-entered while adjusting', () => {
    expect(enterAdjust(adjusting(true), false)).toEqual(adjusting(true));
    expect(enterAdjust(adjusting(false), true)).toEqual(adjusting(false));
  });
});

describe('pointer gesture ownership', () => {
  it('starts a drag from idle and restores idle on release', () => {
    const drag = pointerDown(IDLE_STAGE_MODE, { kind: 'drag' });
    expect(drag.kind).toBe('drag');
    expect(pointerUp(drag)).toEqual(IDLE_STAGE_MODE);
  });

  it('keeps the crop phase and its resume memory through a drag', () => {
    const drag = pointerDown(adjusting(true), { kind: 'drag' });
    expect(drag.kind).toBe('drag');
    if (drag.kind !== 'drag') return;
    expect(drag.returnTo).toEqual({ adjust: true, resumePlayback: true });
    const restored = pointerUp(drag);
    expect(restored).toEqual(adjusting(true));
    expect(shouldResumePlayback(restored)).toBe(true);
  });

  it('allows a resize only from the crop phase', () => {
    expect(pointerDown(IDLE_STAGE_MODE, { kind: 'resize', handle: 'se' })).toEqual(IDLE_STAGE_MODE);
    const resize = pointerDown(adjusting(false), { kind: 'resize', handle: 'se' });
    expect(resize.kind).toBe('resize');
    if (resize.kind !== 'resize') return;
    expect(resize.handle).toBe('se');
    expect(pointerUp(resize)).toEqual(adjusting(false));
  });

  it('does not let the eyedropper or an active gesture start another gesture', () => {
    const pick: StageMode = { kind: 'pick-pad' };
    expect(pointerDown(pick, { kind: 'drag' })).toEqual(pick);
    const drag = pointerDown(IDLE_STAGE_MODE, { kind: 'drag' });
    expect(pointerDown(drag, { kind: 'resize', handle: 'n' })).toBe(drag);
    expect(pointerDown(drag, { kind: 'drag' })).toBe(drag);
  });
});

describe('stage mode view', () => {
  it('gives pick precedence over adjust so the two never coexist', () => {
    expect(stageModeOf({ adjustFrame: true, picking: false }).kind).toBe('adjust');
    expect(stageModeOf({ adjustFrame: false, picking: true }).kind).toBe('pick-pad');
    expect(stageModeOf({ adjustFrame: true, picking: true }).kind).toBe('pick-pad');
    expect(stageModeOf({ adjustFrame: false, picking: false })).toBe(IDLE_STAGE_MODE);
  });
});
