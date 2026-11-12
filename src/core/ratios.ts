export type Orientation = 'portrait' | 'landscape' | 'square';

/** The Mudae card proportion; the default Frame. */
export const MUDAE_RATIO = 9 / 14;

/** The two Carta Export sizes. */
export type CartaScale = 1 | 2;

export interface RatioPreset {
  readonly id: string;
  readonly label: string;
  readonly ratio: number;
  readonly orientation: Orientation;
}

/** The ratio families offered by the Frame proportion popover. */
export const RATIO_PRESETS: readonly RatioPreset[] = Object.freeze([
  { id: 'mudae', label: 'Mudae 9:14', ratio: MUDAE_RATIO, orientation: 'portrait' },
  {
    id: 'mudae-landscape',
    label: 'Mudae 14:9',
    ratio: 14 / 9,
    orientation: 'landscape',
  },
  { id: '4x5', label: '4:5', ratio: 4 / 5, orientation: 'portrait' },
  { id: '5x4', label: '5:4', ratio: 5 / 4, orientation: 'landscape' },
  { id: '3x4', label: '3:4', ratio: 3 / 4, orientation: 'portrait' },
  { id: '4x3', label: '4:3', ratio: 4 / 3, orientation: 'landscape' },
  { id: '2x3', label: '2:3', ratio: 2 / 3, orientation: 'portrait' },
  { id: '3x2', label: '3:2', ratio: 3 / 2, orientation: 'landscape' },
  { id: 'square', label: '1:1', ratio: 1, orientation: 'square' },
  { id: '16x9', label: '16:9', ratio: 16 / 9, orientation: 'landscape' },
  { id: '9x16', label: '9:16', ratio: 9 / 16, orientation: 'portrait' },
  { id: '21x9', label: '21:9', ratio: 21 / 9, orientation: 'landscape' },
  { id: '9x21', label: '9:21', ratio: 9 / 21, orientation: 'portrait' },
]);

/**
 * How close a ratio must be to a preset to *be* that preset (labels, Carta,
 * persistence). Snapping to a preset while dragging uses a wider 3%.
 */
export const RATIO_MATCH_TOLERANCE = 0.001;

/**
 * How close a free drag's raw ratio must be to a preset before it snaps. The
 * drag reads the ratio from its accumulated travel, never from the snapped
 * document, so leaving the band takes the same travel at any pointer speed.
 */
export const SNAP_TOLERANCE = 0.03;

export function matchesRatio(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return false;
  return Math.abs(a / b - 1) <= RATIO_MATCH_TOLERANCE;
}

/**
 * The presets shown for an Orientation. Square has no side to flip to, so it
 * still lists every preset; that is the only way out of a 1:1 Frame.
 */
export function presetsFor(orientation: Orientation): readonly RatioPreset[] {
  if (orientation === 'square') return RATIO_PRESETS;
  return RATIO_PRESETS.filter(
    (preset) => preset.orientation === orientation || preset.orientation === 'square',
  );
}

/** The preset a proportion *is* within 0.1%, or null for a free proportion. */
export function presetForRatio(ratio: number): RatioPreset | null {
  return RATIO_PRESETS.find((preset) => matchesRatio(preset.ratio, ratio)) ?? null;
}

/** The label for a Frame proportion: preset label or `Personalizado`. */
export function ratioLabel(ratio: number): string {
  return presetForRatio(ratio)?.label ?? 'Personalizado';
}

/**
 * The nearest ratio preset within `tolerance` (relative to `ratio`), or null.
 * Both orientations are considered, so a free drag can land on 9:16 or 16:9.
 * `excludeRatio` drops the preset the drag started on, so releasing the lock
 * never pulls the Frame back to its own starting proportion.
 */
export function snapRatio(
  ratio: number,
  tolerance = SNAP_TOLERANCE,
  excludeRatio?: number,
): RatioPreset | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  let best: RatioPreset | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const preset of RATIO_PRESETS) {
    if (excludeRatio !== undefined && matchesRatio(preset.ratio, excludeRatio)) continue;
    const delta = Math.abs(preset.ratio / ratio - 1);
    if (delta <= tolerance && delta < bestDelta) {
      best = preset;
      bestDelta = delta;
    }
  }
  return best;
}

export function ratioOrientation(ratio: number): Orientation {
  if (matchesRatio(ratio, 1)) return 'square';
  return ratio > 1 ? 'landscape' : 'portrait';
}

/** The same Frame turned on its side. 1:1 is its own flip. */
export function flipRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return ratio;
  return 1 / ratio;
}

/**
 * The canonical Mudae Export size for a ratio, or null when the ratio is not
 * Mudae. Portrait is 225×350 (1×) / 450×700 (2×); landscape is the swap.
 */
export function mudaeExportSize(
  ratio: number,
  scale: CartaScale,
): { width: number; height: number } | null {
  const portrait = matchesRatio(ratio, MUDAE_RATIO);
  const landscape = matchesRatio(ratio, flipRatio(MUDAE_RATIO));
  if (!portrait && !landscape) return null;
  if (portrait) {
    return scale === 2 ? { width: 450, height: 700 } : { width: 225, height: 350 };
  }
  return scale === 2 ? { width: 700, height: 450 } : { width: 350, height: 225 };
}

/** 1, 2 or null: which Carta preset the current output size is. */
export function mudaeScaleOf(
  size: { width: number; height: number },
  ratio: number,
): CartaScale | null {
  for (const scale of [1, 2] as const) {
    const canonical = mudaeExportSize(ratio, scale);
    if (canonical && size.width === canonical.width && size.height === canonical.height) {
      return scale;
    }
  }
  return null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * A stable slug for a ratio: the exact presets keep their ids, and every other
 * ratio is its reduced `WxH` form (e.g. `6x5` for 1.2).
 */
export function ratioSlug(ratio: number): string {
  const preset = presetForRatio(ratio);
  if (preset) return preset.id;
  if (!Number.isFinite(ratio) || ratio <= 0) return 'custom';
  const height = 1000;
  const width = Math.round(ratio * height);
  const divisor = gcd(width, height);
  return `${width / divisor}x${height / divisor}`;
}
