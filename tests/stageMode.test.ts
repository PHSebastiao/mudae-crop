import { describe, expect, it } from 'vitest';
import {
  closeAdjust,
  enterAdjust,
  enterPickPad,
  IDLE_STAGE_MODE,
  leavePick,
  shouldResumePlayback,
  type StageMode,
} from '../src/core/stageMode';

function adjusting(resumePlayback: boolean): StageMode {
  return { kind: 'adjust', resumePlayback };
}

describe('stage mode exclusivity', () => {
  it('leaves the crop phase when the Pad eyedropper is armed', () => {
    expect(enterPickPad(adjusting(true))).toEqual({ kind: 'pick-pad' });
  });

  it('clears the Pad eyedropper when the crop phase is entered', () => {
    expect(enterAdjust({ kind: 'pick-pad' }, false)).toEqual(adjusting(false));
  });

  it('leaves pick only from pick and adjust only from adjust', () => {
    expect(leavePick({ kind: 'pick-pad' })).toBe(IDLE_STAGE_MODE);
    expect(leavePick(adjusting(true))).toEqual(adjusting(true));
    expect(closeAdjust(adjusting(true))).toBe(IDLE_STAGE_MODE);
    expect(closeAdjust({ kind: 'pick-pad' })).toEqual({ kind: 'pick-pad' });
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
    expect(closeAdjust(playingAtEntry)).toBe(IDLE_STAGE_MODE);

    const pausedAtEntry = enterAdjust(IDLE_STAGE_MODE, false);
    expect(shouldResumePlayback(pausedAtEntry)).toBe(false);
    expect(closeAdjust(pausedAtEntry)).toBe(IDLE_STAGE_MODE);
  });

  it('does not overwrite the memory when adjust is re-entered while adjusting', () => {
    expect(enterAdjust(adjusting(true), false)).toEqual(adjusting(true));
    expect(enterAdjust(adjusting(false), true)).toEqual(adjusting(false));
  });
});
