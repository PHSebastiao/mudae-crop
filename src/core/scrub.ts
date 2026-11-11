/** How far the pointer must travel before a press on a numeric field becomes a drag. */
export const SCRUB_THRESHOLD = 3;

/** A vertical scrub in progress: where it started and where the pointer was last seen. */
export interface ScrubGesture {
  readonly startY: number;
  readonly lastY: number;
  readonly active: boolean;
}

export interface ScrubResult {
  readonly gesture: ScrubGesture;
  /** The value the drag asks for, or null while the press is still a click. */
  readonly value: number | null;
}

export function beginScrub(y: number): ScrubGesture {
  return { startY: y, lastY: y, active: false };
}

export type DragIntent = 'pending' | 'scrub' | 'select';

/**
 * Decide what a press on a numeric field became from how far the pointer has
 * travelled. The first axis to leave the threshold wins: dragging mostly
 * vertically scrubs the value, dragging mostly sideways is the field's own
 * text selection, so part of the number can be picked with the mouse.
 */
export function dragIntent(dx: number, dy: number): DragIntent {
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (down >= SCRUB_THRESHOLD && down > across) return 'scrub';
  if (across >= SCRUB_THRESHOLD && across > down) return 'select';
  return 'pending';
}

/**
 * Advance a vertical scrub. Dragging up increases the value, because screen Y
 * grows downwards, and every pixel applies `step` once the gesture activates.
 * The first move past the threshold applies the whole distance from the press,
 * so the readout follows the pointer instead of swallowing the first 3 px.
 */
export function scrubTo(
  gesture: ScrubGesture,
  value: number,
  y: number,
  step: number,
): ScrubResult {
  if (!gesture.active && Math.abs(y - gesture.startY) < SCRUB_THRESHOLD) {
    return { gesture, value: null };
  }
  const from = gesture.active ? gesture.lastY : gesture.startY;
  return {
    gesture: { startY: gesture.startY, lastY: y, active: true },
    value: value + (from - y) * step,
  };
}
