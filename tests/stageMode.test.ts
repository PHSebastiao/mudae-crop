import { describe, expect, it } from 'vitest';
import {
  closeAdjust,
  enterAdjust,
  enterPickPad,
  IDLE_STAGE_MODE,
  leavePick,
  type StageMode,
} from '../src/core/stageMode';

function adjusting(): StageMode {
  return { kind: 'adjust' };
}

describe('stage mode exclusivity', () => {
  it('leaves the crop phase when the Pad eyedropper is armed', () => {
    expect(enterPickPad(adjusting())).toEqual({ kind: 'pick-pad' });
  });

  it('clears the Pad eyedropper when the crop phase is entered', () => {
    expect(enterAdjust({ kind: 'pick-pad' })).toEqual(adjusting());
  });

  it('leaves pick only from pick and adjust only from adjust', () => {
    expect(leavePick({ kind: 'pick-pad' })).toBe(IDLE_STAGE_MODE);
    expect(leavePick(adjusting())).toEqual(adjusting());
    expect(closeAdjust(adjusting())).toBe(IDLE_STAGE_MODE);
    expect(closeAdjust({ kind: 'pick-pad' })).toEqual({ kind: 'pick-pad' });
  });

  it('does not replace an existing adjust mode', () => {
    const current = adjusting();
    expect(enterAdjust(current)).toBe(current);
  });
});
