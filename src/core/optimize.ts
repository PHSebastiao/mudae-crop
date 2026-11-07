import type { OptimizeSettings } from './document';
import type { GifEncodeFrame } from './gif';
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

/**
 * Merge consecutive identical frames, adding the dropped frame's delay to the
 * one that remains so the total animation time never changes.
 */
export function dropDuplicateFrames(frames: readonly GifEncodeFrame[]): {
  frames: GifEncodeFrame[];
  dropped: number;
} {
  if (frames.length === 0) return { frames: [], dropped: 0 };
  const merged: GifEncodeFrame[] = [{ ...frames[0] }];
  let dropped = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = frames[index];
    if (sameFramePixels(previous.pixels, current.pixels)) {
      merged[merged.length - 1] = {
        pixels: previous.pixels,
        delayMs: previous.delayMs + current.delayMs,
      };
      dropped += 1;
    } else {
      merged.push({ ...current });
    }
  }
  return { frames: merged, dropped };
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
    return (
      decoded.width === width &&
      decoded.height === height &&
      decoded.frames.length > 0
    );
  } catch {
    return false;
  }
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
  let bestBytes = baseBytes;
  let bestLossy = settings.lossy;
  let bestColors: number | null = null;
  let attempts = 0;
  let error: string | undefined;
  const target = settings.targetEnabled ? settings.targetBytes : null;

  let width = 0;
  let height = 0;
  try {
    const base = decodeGif(baseBytes);
    width = base.width;
    height = base.height;
  } catch {
    return {
      bytes: baseBytes,
      size: baseBytes.length,
      targetBytes: target,
      met: target === null ? null : baseBytes.length <= target,
      lossy: settings.lossy,
      colors: null,
      attempts: 0,
      droppedFrames,
      error: 'O GIF base é inválido.',
    };
  }

  if (target !== null && baseBytes.length <= target) {
    return {
      bytes: baseBytes,
      size: baseBytes.length,
      targetBytes: target,
      met: true,
      lossy: settings.lossy,
      colors: null,
      attempts: 0,
      droppedFrames,
    };
  }

  const lossyCandidates =
    target === null
      ? settings.lossy > 0
        ? [settings.lossy]
        : []
      : uniqueAscending([settings.lossy, 40, 60, 80, 100, 140, 180, 200], 200);
  const colorCandidates = settings.reduceColors
    ? target === null
      ? [settings.colors]
      : uniqueDescending([settings.colors, 128, 96, 64, 48, 32, 24, 16], 8).filter(
          (colors) => colors <= settings.colors,
        )
    : [];

  const planned = lossyCandidates.length + colorCandidates.length;

  const met = () => target !== null && bestBytes.length <= target;

  const tryCompress = async (lossy: number, colors: number | null): Promise<boolean> => {
    if (hooks.signal?.aborted) throw new OptimizeCancelledError();
    attempts += 1;
    hooks.onProgress?.(attempts, Math.max(attempts, planned));
    try {
      const candidate = await optimizer.compress(baseBytes, {
        lossy,
        colors,
        level: 1,
      });
      if (!isValidGif(candidate, width, height)) {
        error = 'O compressor devolveu um GIF inválido.';
        return false;
      }
      if (candidate.length >= bestBytes.length) return false;
      bestBytes = candidate;
      bestLossy = lossy;
      bestColors = colors;
      return true;
    } catch {
      error =
        'Não foi possível comprimir o GIF; o arquivo sem otimização foi mantido.';
      return false;
    }
  };

  for (const lossy of lossyCandidates) {
    if (hooks.signal?.aborted) throw new OptimizeCancelledError();
    await tryCompress(lossy, null);
    if (met()) break;
  }

  if (colorCandidates.length > 0 && (target === null || !met())) {
    for (const colors of colorCandidates) {
      if (hooks.signal?.aborted) throw new OptimizeCancelledError();
      await tryCompress(bestLossy, colors);
      if (met()) break;
    }
  }

  return {
    bytes: bestBytes,
    size: bestBytes.length,
    targetBytes: target,
    met: target === null ? null : bestBytes.length <= target,
    lossy: bestLossy,
    colors: bestColors,
    attempts,
    droppedFrames,
    ...(error ? { error } : {}),
  };
}
