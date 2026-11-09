import type { Size } from './rect';

/** The allowed relative drift before an output is called stretched. */
export const ASPECT_TOLERANCE = 0.005;

export function aspectMatches(output: Size, ratio: number, tolerance = ASPECT_TOLERANCE): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0 || output.height <= 0) return false;
  const idealWidth = output.height * ratio;
  // Rounding a native crop to whole pixels can drift a tiny export well past a
  // relative tolerance, so one pixel of slack is always allowed.
  return Math.abs(output.width - idealWidth) <= Math.max(1, idealWidth * tolerance);
}

/** The output ratio as `1,56:1` or `1:1,56`, matching the app's decimal comma. */
export function formatAspect(size: Size): string {
  if (size.width <= 0 || size.height <= 0) return '0:1';
  if (size.width < size.height) {
    return `1:${(size.height / size.width).toFixed(2).replace('.', ',')}`;
  }
  return `${(size.width / size.height).toFixed(2).replace('.', ',')}:1`;
}

/** True when the output asks for pixels the Source does not have. */
export function exceedsSource(output: Size, source: Size | null | undefined): boolean {
  if (!source) return false;
  return output.width > source.width || output.height > source.height;
}

/**
 * Mudae's practical size guidance. It is a warning, not a block: Image Chest
 * still accepts the upload up to its own 30 MB ceiling.
 */
export const MUDAE_SIZE_GUIDANCE_BYTES = 10 * 1024 * 1024;

/** Whether an Export of this size should show the 10 MB hint. */
export function exceedsSizeGuidance(bytes: number | null | undefined): boolean {
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > MUDAE_SIZE_GUIDANCE_BYTES;
}
