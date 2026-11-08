import { describe, expect, it } from 'vitest';
import { GifError, decodeGif, encodeGif } from '../src/core/gif';
import { buildGif, pixelAt } from './gifFixtures';

const RED: readonly [number, number, number] = [255, 0, 0];
const GREEN: readonly [number, number, number] = [0, 255, 0];
const BLUE: readonly [number, number, number] = [0, 0, 255];

function row(pixels: Uint8ClampedArray, width: number, y = 0): number[][] {
  return Array.from({ length: width }, (_, x) => pixelAt(pixels, width, x, y));
}

describe('GIF decode', () => {
  it('keeps the previous frame under a partial frame with disposal 1', () => {
    const gif = buildGif({
      width: 3,
      height: 1,
      frames: [
        { width: 3, height: 1, palette: [RED], indices: [0, 0, 0], disposal: 1 },
        { left: 1, width: 1, height: 1, palette: [GREEN], indices: [0], disposal: 1 },
      ],
    });

    const decoded = decodeGif(gif);

    expect(decoded.frames).toHaveLength(2);
    expect(row(decoded.frames[0].pixels, 3)).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(row(decoded.frames[1].pixels, 3)).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]);
  });

  it('clears the previous frame rectangle with disposal 2', () => {
    const gif = buildGif({
      width: 3,
      height: 1,
      frames: [
        { width: 3, height: 1, palette: [RED], indices: [0, 0, 0], disposal: 2 },
        { left: 1, width: 1, height: 1, palette: [GREEN], indices: [0], disposal: 1 },
      ],
    });

    const decoded = decodeGif(gif);

    expect(row(decoded.frames[1].pixels, 3)).toEqual([
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
  });

  it('restores the canvas from before the frame with disposal 3', () => {
    const gif = buildGif({
      width: 3,
      height: 1,
      frames: [
        { width: 3, height: 1, palette: [RED], indices: [0, 0, 0], disposal: 3 },
        { left: 1, width: 1, height: 1, palette: [GREEN], indices: [0], disposal: 1 },
        { left: 0, width: 1, height: 1, palette: [BLUE], indices: [0], disposal: 1 },
      ],
    });

    const decoded = decodeGif(gif);

    // Frame 1 is visible, then restored before frame 2 is drawn.
    expect(row(decoded.frames[0].pixels, 3)).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(row(decoded.frames[1].pixels, 3)).toEqual([
      [0, 0, 0, 0],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
    expect(row(decoded.frames[2].pixels, 3)).toEqual([
      [0, 0, 255, 255],
      [0, 255, 0, 255],
      [0, 0, 0, 0],
    ]);
  });

  it('skips the transparent index and keeps what was underneath', () => {
    const gif = buildGif({
      width: 3,
      height: 1,
      frames: [
        { width: 3, height: 1, palette: [RED], indices: [0, 0, 0], disposal: 1 },
        {
          width: 3,
          height: 1,
          palette: [GREEN, [9, 9, 9]],
          indices: [0, 1, 0],
          transparentIndex: 1,
          disposal: 1,
        },
      ],
    });

    expect(row(decodeGif(gif).frames[1].pixels, 3)).toEqual([
      [0, 255, 0, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
  });

  it('applies the 20 ms floor to per-frame delays', () => {
    const gif = buildGif({
      width: 1,
      height: 1,
      frames: [
        { width: 1, height: 1, palette: [RED], indices: [0], delayCs: 1 },
        { width: 1, height: 1, palette: [RED], indices: [0], delayCs: 4 },
      ],
    });

    expect(decodeGif(gif).frames.map((frame) => frame.delayMs)).toEqual([20, 40]);
  });

  it('puts interlaced rows back in their real order', () => {
    const gif = buildGif({
      width: 1,
      height: 4,
      frames: [
        {
          width: 1,
          height: 4,
          palette: [RED, GREEN, BLUE, [255, 255, 255]],
          // Interlaced order is rows 0, 2, 1, 3.
          indices: [0, 2, 1, 3],
          interlace: true,
        },
      ],
    });

    const pixels = decodeGif(gif).frames[0].pixels;
    expect([0, 1, 2, 3].map((y) => pixelAt(pixels, 1, 0, y))).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('reads the Netscape loop count and leaves a one-shot without one', () => {
    const looping = buildGif({
      width: 1,
      height: 1,
      loopCount: 3,
      frames: [{ width: 1, height: 1, palette: [RED], indices: [0] }],
    });
    const once = buildGif({
      width: 1,
      height: 1,
      frames: [{ width: 1, height: 1, palette: [RED], indices: [0] }],
    });

    expect(decodeGif(looping).loopCount).toBe(3);
    expect(decodeGif(once).loopCount).toBeNull();
  });

  it('rejects bytes that are not a GIF', () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toThrow(
      GifError,
    );
  });

  it('decodes a GIF written by an external encoder', () => {
    // Pillow, 4×2, two frames (red then blue), 120 ms and 80 ms, loop forever.
    const external =
      'R0lGODlhBAACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQEDAAAACwAAAAABAACAAAIBwABCBwoMCAAIfkEBQgAAQAsAAAAAAQAAgCBAAD/AAAAAAAAAAAACAcAAQgcKDAgADs=';

    const decoded = decodeGif(new Uint8Array(Buffer.from(external, 'base64')));

    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(2);
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([120, 80]);
    expect(decoded.loopCount).toBe(0);
    expect(pixelAt(decoded.frames[0].pixels, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(decoded.frames[1].pixels, 4, 3, 1)).toEqual([0, 0, 255, 255]);
  });
});

describe('GIF encode', () => {
  function solid(
    width: number,
    height: number,
    color: [number, number, number],
  ): Uint8ClampedArray {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = color[0];
      pixels[index * 4 + 1] = color[1];
      pixels[index * 4 + 2] = color[2];
      pixels[index * 4 + 3] = 255;
    }
    return pixels;
  }

  it('round-trips frame count, dimensions, delays and loop count', async () => {
    const bytes = await encodeGif(
      [
        { pixels: solid(2, 2, [255, 0, 0]), delayMs: 80 },
        { pixels: solid(2, 2, [0, 255, 0]), delayMs: 5 },
      ],
      { width: 2, height: 2, loopCount: 0 },
    );

    const decoded = decodeGif(bytes);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([80, 20]);
    expect(decoded.loopCount).toBe(0);
    expect(row(decoded.frames[0].pixels, 2)).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(row(decoded.frames[1].pixels, 2)).toEqual([
      [0, 255, 0, 255],
      [0, 255, 0, 255],
    ]);
  });

  it('preserves a finite loop count', async () => {
    const bytes = await encodeGif([{ pixels: solid(1, 1, [1, 2, 3]), delayMs: 100 }], {
      width: 1,
      height: 1,
      loopCount: 4,
    });

    expect(decodeGif(bytes).loopCount).toBe(4);
  });

  it('omits the loop extension for a one-shot animation', async () => {
    const bytes = await encodeGif([{ pixels: solid(1, 1, [1, 2, 3]), delayMs: 100 }], {
      width: 1,
      height: 1,
      loopCount: null,
    });

    expect(decodeGif(bytes).loopCount).toBeNull();
  });

  it('keeps transparent pixels transparent', async () => {
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
    const bytes = await encodeGif([{ pixels, delayMs: 100 }], {
      width: 2,
      height: 1,
      loopCount: 0,
    });

    expect(row(decodeGif(bytes).frames[0].pixels, 2)).toEqual([
      [255, 0, 0, 255],
      [0, 0, 0, 0],
    ]);
  });
});
