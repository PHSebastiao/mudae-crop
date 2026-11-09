/**
 * The Stage is always in exactly one interaction mode. The union makes the
 * mutually exclusive states unrepresentable: there is no value that is both
 * adjusting and picking. `App` owns the single value and passes it down.
 */
export type StageMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adjust'; readonly resumePlayback: boolean }
  | { readonly kind: 'pick-pad' };

export const IDLE_STAGE_MODE: StageMode = { kind: 'idle' };

/**
 * Whether leaving the current mode must resume playback. Only an adjust mode
 * entered while playing carries the flag; a phase entered while paused never
 * starts playback later.
 */
export function shouldResumePlayback(mode: StageMode): boolean {
  return mode.kind === 'adjust' && mode.resumePlayback;
}

/**
 * Enter the crop phase. A pick is cleared by construction, and the playback
 * that was running is remembered in the state. Entering while already
 * adjusting is a no-op so a repeated toggle cannot overwrite the memory.
 */
export function enterAdjust(mode: StageMode, playing: boolean): StageMode {
  if (mode.kind === 'adjust') return mode;
  return { kind: 'adjust', resumePlayback: playing };
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
