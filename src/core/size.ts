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
