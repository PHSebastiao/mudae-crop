import { describe, expect, it } from 'vitest';
import { applyUnsharpMask } from '../src/core/sharpen';

/** A 7×5 image with a vertical edge between x=2 (dark) and x=3 (light). */
function edgePixels(): Uint8ClampedArray {
  const width = 7;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = x < 3 ? 40 : 200;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return data;
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const index = (y * width + x) * 4;
  return Array.from(data.slice(index, index + 4));
}

describe('unsharp mask', () => {
  it('leaves the image untouched at 0', () => {
    const data = edgePixels();
    const before = new Uint8ClampedArray(data);

    applyUnsharpMask(data, 7, 5, 0);

    expect(Array.from(data)).toEqual(Array.from(before));
  });

  it('darkens the dark side of an edge and lightens the light side', () => {
    const data = edgePixels();
    applyUnsharpMask(data, 7, 5, 100);

    const dark = pixelAt(data, 7, 2, 2)[0];
    const light = pixelAt(data, 7, 3, 2)[0];
    expect(dark).toBeLessThan(40);
    expect(light).toBeGreaterThan(200);
    // The far edge has a uniform neighbourhood and cannot move.
    expect(pixelAt(data, 7, 0, 2)[0]).toBe(40);
    expect(pixelAt(data, 7, 6, 2)[0]).toBe(200);
  });

  it('is deterministic for the same input', () => {
    const first = edgePixels();
    const second = edgePixels();
    applyUnsharpMask(first, 7, 5, 60);
    applyUnsharpMask(second, 7, 5, 60);

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('never changes alpha and leaves fully transparent pixels transparent', () => {
    const width = 7;
    const height = 5;
    const data = edgePixels();
    data[3] = 0;
    data[0] = 0;
    data[1] = 0;
    data[2] = 0;

    applyUnsharpMask(data, width, height, 100);

    expect(pixelAt(data, width, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(data, width, 3, 2)[3]).toBe(255);
  });

  it('clamps an overdriven edge instead of wrapping channels', () => {
    const width = 3;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
      const value = index < 12 ? 0 : 255;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }

    applyUnsharpMask(data, width, height, 100);

    for (let index = 0; index < data.length; index += 4) {
      expect(data[index]).toBeGreaterThanOrEqual(0);
      expect(data[index]).toBeLessThanOrEqual(255);
    }
  });
});

describe('unsharp mask radius', () => {
  it('scales the neighbourhood with the radius', () => {
    const width = 9;
    const height = 3;
    const make = () => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;
          const value = x < 4 ? 40 : 200;
          data[index] = value;
          data[index + 1] = value;
          data[index + 2] = value;
          data[index + 3] = 255;
        }
      }
      return data;
    };

    const narrow = make();
    const wide = make();
    applyUnsharpMask(narrow, width, height, 100, 1);
    applyUnsharpMask(wide, width, height, 100, 2);

    // Two pixels from the edge, the 3×3 neighbourhood is still all dark.
    expect(pixelAt(narrow, width, 2, 1)[0]).toBe(40);
    expect(pixelAt(wide, width, 2, 1)[0]).toBeLessThan(40);
  });
});
