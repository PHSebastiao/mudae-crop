import {
  clampTrim,
  effectiveDelayMs,
  isAnimated,
  trimFrameCount,
  type Source,
  type Trim,
} from './document';

/** One cycle of the active Trim at the requested speed, in milliseconds. */
export function trimDurationMs(
  source: Source | null | undefined,
  trim: Trim | null,
  speed = 1,
): number {
  const range = clampTrim(source, trim);
  if (!range || !isAnimated(source)) return 0;
  let total = 0;
  for (let index = range.start; index <= range.end; index += 1) {
    total += effectiveDelayMs(source, index, speed);
  }
  return total;
}

/** Absolute animation indices in the active Trim, start first. */
export function trimmedIndices(source: Source | null | undefined, trim: Trim | null): number[] {
  const range = clampTrim(source, trim);
  if (!range || !isAnimated(source)) return [0];
  return Array.from(
    { length: trimFrameCount(source, trim) },
    (_, index) => range.start + index,
  );
}

/**
 * Up to `limit` indices spread evenly across the Trim. The first and last
 * frames are always included, so a short animation is sampled completely.
 */
export function sampleTrimIndices(
  source: Source | null | undefined,
  trim: Trim | null,
  limit: number,
): number[] {
  const indices = trimmedIndices(source, trim);
  if (limit <= 0 || indices.length === 0) return [];
  if (indices.length <= limit) return indices;
  if (limit === 1) return [indices[0]];
  const step = (indices.length - 1) / (limit - 1);
  const sampled = new Set<number>();
  for (let slot = 0; slot < limit; slot += 1) {
    sampled.add(indices[Math.round(slot * step)]);
  }
  return [...sampled].sort((a, b) => a - b);
}

/** Seconds rendered as one decimal, for the timeline readout. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0,0 s';
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Minutes and seconds, for long video durations. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The GIF-style readout for short clips, clock style for long videos. */
export function formatPlaybackDuration(ms: number): string {
  return ms >= 60_000 ? formatClock(ms) : formatDuration(ms);
}
