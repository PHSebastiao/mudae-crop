/**
 * The Stage is always in exactly one interaction mode. The union makes the
 * mutually exclusive states unrepresentable: there is no value that is both
 * adjusting and picking.
 */
export type StageMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adjust'; readonly resumePlayback: boolean }
  | { readonly kind: 'pick-pad' };

export const IDLE_STAGE_MODE: StageMode = { kind: 'idle' };

/** True while the Frame handles and the dimmed backdrop are active. */
export function isAdjusting(mode: StageMode): boolean {
  return mode.kind === 'adjust';
}

/** True while the Pad eyedropper owns the pointer. */
export function isPicking(mode: StageMode): boolean {
  return mode.kind === 'pick-pad';
}

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

/**
 * Arm the Pad eyedropper. Adjust and pick can never coexist: entering pick
 * discards an adjust phase. The caller is expected to close adjust first when
 * it needs the playback-resume side effect (`closeAdjust` + `shouldResumePlayback`).
 */
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

/**
 * The Stage's own view of the phase while its props still arrive as the two
 * booleans `App` owns. Pick wins: the eyedropper takes over the pointer and the
 * handles are hidden, matching the props `App` keeps exclusive.
 */
export function stageModeOf(state: {
  readonly adjustFrame: boolean;
  readonly picking: boolean;
}): StageMode {
  if (state.picking) return { kind: 'pick-pad' };
  if (state.adjustFrame) return { kind: 'adjust', resumePlayback: false };
  return IDLE_STAGE_MODE;
}
