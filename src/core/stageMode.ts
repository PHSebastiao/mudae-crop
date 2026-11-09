import type { Handle } from './rect';

/**
 * The Stage is always in exactly one interaction mode. The union makes the
 * mutually exclusive states unrepresentable: there is no value that is both
 * adjusting and picking, and a pointer gesture owns the pointer only inside
 * `drag` or `resize`.
 */
export type StageMode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'adjust'; readonly resumePlayback: boolean }
  | { readonly kind: 'pick-pad' }
  | { readonly kind: 'drag'; readonly returnTo: GestureReturn }
  | {
      readonly kind: 'resize';
      readonly handle: Handle;
      readonly returnTo: GestureReturn;
    };

/**
 * The base mode a pointer gesture belongs to. A drag can start from idle (the
 * Crop pans) or from adjust (the Frame window moves); the gesture carries that
 * base so releasing the pointer restores the same phase. The resume flag rides
 * along so a drag inside adjust never loses the paused playback memory.
 */
export interface GestureReturn {
  readonly adjust: boolean;
  readonly resumePlayback: boolean;
}

/** The gestures a pointer may start. A resize always names its handle. */
export type PointerGesture =
  { readonly kind: 'drag' } | { readonly kind: 'resize'; readonly handle: Handle };

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

/** Escape cancels whatever interaction owns the Stage and returns to idle. */
export function escape(mode: StageMode): StageMode {
  return mode.kind === 'idle' ? mode : IDLE_STAGE_MODE;
}

/**
 * Start a gesture if the current mode allows it. A pick-pad click is handled
 * as a colour sample, not as a gesture, and one pointer can own the Stage at a
 * time. A drag is allowed from idle and adjust; a resize only from adjust,
 * where the handles are shown.
 */
export function pointerDown(mode: StageMode, gesture: PointerGesture): StageMode {
  if (mode.kind === 'pick-pad' || mode.kind === 'drag' || mode.kind === 'resize') return mode;
  if (gesture.kind === 'drag') {
    return { kind: 'drag', returnTo: gestureReturnOf(mode) };
  }
  if (mode.kind !== 'adjust') return mode;
  return { kind: 'resize', handle: gesture.handle, returnTo: gestureReturnOf(mode) };
}

/** End the gesture and restore the mode it started from. */
export function pointerUp(mode: StageMode): StageMode {
  if (mode.kind !== 'drag' && mode.kind !== 'resize') return mode;
  return mode.returnTo.adjust
    ? { kind: 'adjust', resumePlayback: mode.returnTo.resumePlayback }
    : IDLE_STAGE_MODE;
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

function gestureReturnOf(mode: StageMode): GestureReturn {
  return mode.kind === 'adjust'
    ? { adjust: true, resumePlayback: mode.resumePlayback }
    : { adjust: false, resumePlayback: false };
}
