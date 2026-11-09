/**
 * The Stage is always in exactly one interaction mode. The union makes the
 * mutually exclusive states unrepresentable: there is no value that is both
 * adjusting and picking. `App` owns the single value and passes it down.
 */
export type StageMode =
  { readonly kind: 'idle' } | { readonly kind: 'adjust' } | { readonly kind: 'pick-pad' };

export const IDLE_STAGE_MODE: StageMode = { kind: 'idle' };

/**
 * Enter the crop phase. A pick is cleared by construction. Playback is not
 * affected: the Source keeps running under the handles. Entering while already
 * adjusting is a no-op.
 */
export function enterAdjust(mode: StageMode): StageMode {
  return mode.kind === 'adjust' ? mode : { kind: 'adjust' };
}

/** Arm the Pad eyedropper. Adjust and pick can never coexist. */
export function enterPickPad(mode: StageMode): StageMode {
  return mode.kind === 'pick-pad' ? mode : { kind: 'pick-pad' };
}

/** Disarm the Pad eyedropper; any other mode is left untouched. */
export function leavePick(mode: StageMode): StageMode {
  return mode.kind === 'pick-pad' ? IDLE_STAGE_MODE : mode;
}

/** Leave the crop phase; any other mode is left untouched. */
export function closeAdjust(mode: StageMode): StageMode {
  return mode.kind === 'adjust' ? IDLE_STAGE_MODE : mode;
}
