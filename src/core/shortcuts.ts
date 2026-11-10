import { MUDAE_RATIO } from './ratios';

/** How much one +/- press changes the zoom readout. */
export const ZOOM_STEP = 1.1;

/** A key event, reduced to what the shortcut map needs. */
export interface ShortcutKey {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

export interface ShortcutOptions {
  /** A text field or other editable control owns the keyboard. */
  readonly typing?: boolean;
}

/** What a key press asks the editor to do. */
export type ShortcutAction =
  | { readonly kind: 'nudge'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'rotate' }
  | { readonly kind: 'border'; readonly delta: number }
  | { readonly kind: 'preset'; readonly ratio: number };

const ARROWS: Record<string, { readonly dx: number; readonly dy: number }> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/**
 * Map one key press to an editor action, or null when the key belongs to
 * something else. Ctrl/Cmd and Alt are reserved for the app's own commands,
 * and a text field keeps every key for itself.
 */
export function resolveShortcut(
  input: ShortcutKey,
  options: ShortcutOptions = {},
): ShortcutAction | null {
  if (options.typing) return null;
  if (input.ctrlKey || input.metaKey || input.altKey) return null;

  const arrow = ARROWS[input.key];
  if (arrow) {
    const step = input.shiftKey ? 10 : 1;
    return { kind: 'nudge', dx: arrow.dx * step, dy: arrow.dy * step };
  }

  switch (input.key) {
    case '+':
    case '=':
      return { kind: 'zoom', factor: ZOOM_STEP };
    case '-':
    case '_':
      return { kind: 'zoom', factor: 1 / ZOOM_STEP };
    case 'r':
    case 'R':
      return { kind: 'rotate' };
    case ']':
      return { kind: 'border', delta: 1 };
    case '[':
      return { kind: 'border', delta: -1 };
    case '1':
      return { kind: 'preset', ratio: MUDAE_RATIO };
    case '2':
      return { kind: 'preset', ratio: 1 };
    default:
      return null;
  }
}
