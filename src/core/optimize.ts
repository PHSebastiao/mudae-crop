import type { OptimizeSettings } from './document';
import { decodeGif } from './gif';

/** One lossy/colour setting handed to the compressor. */
export interface OptimizeCompression {
  /** Gifsicle lossy strength, 0–200. */
  readonly lossy: number;
  /** Palette size, or null to keep the current colours. */
  readonly colors: number | null;
  /** Gifsicle optimization level; 1 keeps large files responsive. */
  readonly level: number;
}

/**
 * The platform's lossy GIF compressor. The core owns the target-size loop; the
 * adapter owns gifsicle.
 */
export interface GifOptimizer {
  compress(bytes: Uint8Array, options: OptimizeCompression): Promise<Uint8Array>;
}

export interface OptimizeResult {
  readonly bytes: Uint8Array;
  readonly size: number;
  /** Size of the re-encoded GIF before the optimizer ran. */
  readonly baseSize: number;
  /** Null when the size target is turned off. */
  readonly targetBytes: number | null;
  /** Null when there is no target; otherwise whether the target was met. */
  readonly met: boolean | null;
  readonly lossy: number;
  readonly colors: number | null;
  readonly attempts: number;
  readonly droppedFrames: number;
  /** Set when the compressor or a candidate failed; the base bytes are kept. */
  readonly error?: string;
}

export interface OptimizeHooks {
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

export class OptimizeCancelledError extends Error {
  constructor() {
    super('Otimização cancelada.');
    this.name = 'OptimizeCancelledError';
  }
}

export function sameFramePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function uniqueAscending(values: readonly number[], max: number): number[] {
  const sorted = [...new Set(values.map((value) => Math.round(value)))]
    .filter((value) => value > 0 && value <= max)
    .sort((a, b) => a - b);
  return sorted;
}

function uniqueDescending(values: readonly number[], min: number): number[] {
  const sorted = [...new Set(values.map((value) => Math.round(value)))]
    .filter((value) => value >= min && value <= 256)
    .sort((a, b) => b - a);
  return sorted;
}

function isValidGif(bytes: Uint8Array, width: number, height: number): boolean {
  try {
    const decoded = decodeGif(bytes);
    return decoded.width === width && decoded.height === height && decoded.frames.length > 0;
  } catch {
    return false;
  }
}

/** The passes the planner chose for this run. */
interface OptimizePlan {
  readonly lossy: readonly number[];
  readonly colors: readonly number[];
  /**
   * True when the size target is off or the base already fits it. Then only
   * the user's chosen lossy/colour setting runs, never the search ladder —
   * even below the target, the chosen pass still runs.
   */
  readonly firstPassOnly: boolean;
}

/** The best result seen so far; it starts as the untouched base bytes. */
interface BestSoFar {
  bytes: Uint8Array;
  lossy: number;
  colors: number | null;
}

function planFor(
  settings: OptimizeSettings,
  target: number | null,
  baseLength: number,
): OptimizePlan {
  const firstPassOnly = target === null || baseLength <= target;
  const lossy = firstPassOnly
    ? settings.lossy > 0
      ? [settings.lossy]
      : []
    : uniqueAscending([settings.lossy, 40, 60, 80, 100, 140, 180, 200], 200);
  const colors = settings.reduceColors
    ? firstPassOnly
      ? [settings.colors]
      : uniqueDescending([settings.colors, 128, 96, 64, 48, 32, 24, 16], 8).filter(
          (value) => value <= settings.colors,
        )
    : [];
  return { lossy, colors, firstPassOnly };
}

/**
 * The best-so-far replacement rule. Invariant: a candidate may only replace
 * the base once it decodes (see `isValidGif`, checked before this call), so a
 * corrupt or resized compressor result never becomes the returned bytes. A
 * candidate no smaller than the current best is ignored.
 */
function replaceBestSoFar(
  best: BestSoFar,
  candidate: Uint8Array,
  lossy: number,
  colors: number | null,
): boolean {
  if (candidate.length >= best.bytes.length) return false;
  best.bytes = candidate;
  best.lossy = lossy;
  best.colors = colors;
  return true;
}

/**
 * Compress an already-encoded GIF toward a target size. Lossy strength is the
 * primary lever; colour reduction is an optional second pass. Each candidate
 * is decoded (with the same dimensions) before it can replace the base, so a
 * corrupt compressor result is never returned.
 */
export async function optimizeGif(
  baseBytes: Uint8Array,
  settings: OptimizeSettings,
  optimizer: GifOptimizer,
  droppedFrames = 0,
  hooks: OptimizeHooks = {},
): Promise<OptimizeResult> {
  const target = settings.targetEnabled ? settings.targetBytes : null;
  const best: BestSoFar = {
    bytes: baseBytes,
    lossy: settings.lossy,
    colors: null,
  };
  let attempts = 0;
  let error: string | undefined;

  let width = 0;
  let height = 0;
  try {
    const base = decodeGif(baseBytes);
    width = base.width;
    height = base.height;
  } catch {
    // An undecodable base is terminal: there is nothing safe to compress or
    // return, so report it and keep the original bytes.
    return {
      bytes: best.bytes,
      size: best.bytes.length,
      baseSize: baseBytes.length,
      targetBytes: target,
      met: target === null ? null : best.bytes.length <= target,
      lossy: settings.lossy,
      colors: null,
      attempts: 0,
      droppedFrames,
      error: 'O GIF base é inválido.',
    };
  }

  const plan = planFor(settings, target, baseBytes.length);
  const planned = plan.lossy.length + plan.colors.length;
  // The early-exit rule: stop as soon as the best bytes fit the target. With
  // the target off it never fires, so every planned pass runs.
  const met = () => target !== null && best.bytes.length <= target;

  const tryCompress = async (lossy: number, colors: number | null): Promise<void> => {
    if (hooks.signal?.aborted) throw new OptimizeCancelledError();
    attempts += 1;
    hooks.onProgress?.(attempts, Math.max(attempts, planned));
    try {
      const candidate = await optimizer.compress(baseBytes, {
        lossy,
        colors,
        level: 3,
      });
      if (!isValidGif(candidate, width, height)) {
        error = 'O compressor devolveu um GIF inválido.';
        return;
      }
      if (replaceBestSoFar(best, candidate, lossy, colors)) error = undefined;
    } catch {
      error = 'Não foi possível comprimir o GIF; o arquivo sem otimização foi mantido.';
    }
  };

  for (const lossy of plan.lossy) {
    if (hooks.signal?.aborted) throw new OptimizeCancelledError();
    await tryCompress(lossy, null);
    if (met()) break;
  }

  // The colour pass follows the lossy ones: always in first-pass mode, and
  // otherwise only while the target is still missed.
  if (plan.colors.length > 0 && (plan.firstPassOnly || !met())) {
    for (const colors of plan.colors) {
      if (hooks.signal?.aborted) throw new OptimizeCancelledError();
      await tryCompress(best.lossy, colors);
      if (met()) break;
    }
  }

  return {
    bytes: best.bytes,
    size: best.bytes.length,
    baseSize: baseBytes.length,
    targetBytes: target,
    met: target === null ? null : best.bytes.length <= target,
    lossy: best.lossy,
    colors: best.colors,
    attempts,
    droppedFrames,
    ...(error ? { error } : {}),
  };
}
