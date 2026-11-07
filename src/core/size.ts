export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The allowed relative drift before an output is called stretched. */
export const ASPECT_TOLERANCE = 0.005;

export function aspectMatches(output: Size, frame: Size, tolerance = ASPECT_TOLERANCE): boolean {
  if (frame.width <= 0 || frame.height <= 0 || output.height <= 0) return false;
  const outputRatio = output.width / output.height;
  const frameRatio = frame.width / frame.height;
  return Math.abs(outputRatio / frameRatio - 1) <= tolerance;
}

/** The output ratio as `1,56:1`, matching the app's decimal comma. */
export function formatAspect(size: Size): string {
  if (size.height <= 0) return '0:1';
  return `${(size.width / size.height).toFixed(2).replace('.', ',')}:1`;
}

/** How many times the Frame width the output uses. */
export function relativeScale(output: Size, frame: Size): number {
  if (frame.width <= 0) return 1;
  return output.width / frame.width;
}

export function formatScale(scale: number): string {
  return `${scale.toFixed(2).replace('.', ',')}×`;
}

/** True when the output asks for pixels the Source does not have. */
export function exceedsSource(output: Size, source: Size | null | undefined): boolean {
  if (!source) return false;
  return output.width > source.width || output.height > source.height;
}
