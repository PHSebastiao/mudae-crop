import { MAX_SHARPNESS } from './document';

/**
 * A deterministic unsharp mask over unpremultiplied RGBA pixels.
 *
 * The blur is an alpha-weighted box average with a radius in output pixels, so
 * a transparent or partially transparent neighbour never darkens the edge;
 * alpha itself is left alone. `data` is mutated in place.
 */
export function applyUnsharpMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  radius = 1,
): void {
  if (width < 2 || height < 2 || !Number.isFinite(amount) || amount <= 0) return;
  const strength = (Math.min(MAX_SHARPNESS, amount) / 100) * 1.5;
  if (strength <= 0) return;
  const reach = Math.max(1, Math.round(Number.isFinite(radius) ? radius : 1));

  const source = new Uint8ClampedArray(data);
  const blurred = new Float32Array(width * height * 3);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      for (let dy = -reach; dy <= reach; dy += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -reach; dx <= reach; dx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + dx));
          const index = (ny * width + nx) * 4;
          const alpha = source[index + 3] / 255;
          if (alpha === 0) continue;
          r += source[index] * alpha;
          g += source[index + 1] * alpha;
          b += source[index + 2] * alpha;
          alphaSum += alpha;
        }
      }
      const out = (y * width + x) * 3;
      if (alphaSum > 0) {
        blurred[out] = r / alphaSum;
        blurred[out + 1] = g / alphaSum;
        blurred[out + 2] = b / alphaSum;
      }
    }
  }

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    if (source[index + 3] === 0) continue;
    const blurredIndex = pixel * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const original = source[index + channel];
      const value = original + strength * (original - blurred[blurredIndex + channel]);
      data[index + channel] = Math.min(255, Math.max(0, Math.round(value)));
    }
  }
}
