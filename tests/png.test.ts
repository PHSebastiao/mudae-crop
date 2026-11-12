import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodeCanvasPng, encodePng, isOpaqueRgba, type PngCanvas } from '../src/core/png';
import { deflateZlib } from '../src/platform/deflate';
import { contextOf, pngPixels, pngSize } from './helpers';

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
  readonly crc: number;
}

/** Walk the chunks of an encoded PNG, so a test can inspect the real header. */
function chunksOf(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data, crc: view.getUint32(offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function ihdrOf(bytes: Uint8Array): {
  width: number;
  height: number;
  colorType: number;
  bitDepth: number;
  compression: number;
  filter: number;
  interlace: number;
} {
  const [header] = chunksOf(bytes);
  const data = header.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.getUint32(0),
    height: view.getUint32(4),
    bitDepth: data[8],
    colorType: data[9],
    compression: data[10],
    filter: data[11],
    interlace: data[12],
  };
}

/** A photographic raster: gradients under noise, so every filter has work. */
function texturedCanvas(width: number, height: number): Canvas {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  let seed = 12345;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed >>> 16) % 24;
      const index = (y * width + x) * 4;
      image.data[index] = (x * 255) / width + noise;
      image.data[index + 1] = (y * 255) / height + noise;
      image.data[index + 2] = ((x + y) * 255) / (width + height) + noise;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

const identity = async (data: Uint8Array): Promise<Uint8Array> => data;

describe('encodePng', () => {
  it('roundtrips an opaque canvas pixel for pixel', async () => {
    const canvas = texturedCanvas(64, 48);
    const source = contextOf(canvas).getImageData(0, 0, 64, 48).data;
    const bytes = await encodeCanvasPng(canvas as unknown as PngCanvas, deflateZlib);
    expect(pngSize(bytes)).toEqual({ width: 64, height: 48 });
    expect(Buffer.from(await pngPixels(bytes)).equals(Buffer.from(source))).toBe(true);
  });

  it('writes an opaque image as RGB and a transparent one as RGBA', async () => {
    const opaque = await encodePng(
      { data: new Uint8Array(4 * 4 * 4).fill(255), width: 4, height: 4 },
      identity,
    );
    expect(ihdrOf(opaque).colorType).toBe(2);

    const translucent = new Uint8Array(4 * 4 * 4).fill(255);
    translucent[3] = 128;
    const withAlpha = await encodePng({ data: translucent, width: 4, height: 4 }, identity);
    expect(ihdrOf(withAlpha).colorType).toBe(6);
  });

  it('writes chunks with valid CRCs and a zlib stream that inflates', async () => {
    const canvas = texturedCanvas(32, 32);
    const bytes = await encodeCanvasPng(canvas as unknown as PngCanvas, deflateZlib);
    const chunks = chunksOf(bytes);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);

    const header = ihdrOf(bytes);
    expect(header).toMatchObject({
      bitDepth: 8,
      colorType: 2,
      compression: 0,
      filter: 0,
      interlace: 0,
    });

    for (const chunk of chunks) {
      const covered = new Uint8Array(4 + chunk.data.length);
      for (let index = 0; index < 4; index += 1) covered[index] = chunk.type.charCodeAt(index);
      covered.set(chunk.data, 4);
      expect(chunk.crc).toBe(crc32(covered));
    }

    // 32 rows of 32 RGB pixels, each row prefixed with its filter byte.
    const raw = inflateSync(Buffer.from(chunks[1].data));
    expect(raw.length).toBe((32 * 3 + 1) * 32);
  });

  it('keeps every alpha byte of a translucent image', async () => {
    const pixels = new Uint8Array(8 * 4 * 4);
    for (let pixel = 0; pixel < 32; pixel += 1) {
      pixels[pixel * 4] = Math.min(255, 40 + pixel * 7);
      pixels[pixel * 4 + 1] = Math.max(0, 255 - pixel * 5);
      pixels[pixel * 4 + 2] = 128;
      pixels[pixel * 4 + 3] = 8 + pixel * 8;
    }

    const bytes = await encodePng({ data: pixels, width: 8, height: 4 }, deflateZlib);

    expect(ihdrOf(bytes).colorType).toBe(6);
    // The canvas this test decodes through premultiplies and unpremultiplies,
    // so colour survives exactly only where alpha is opaque; the alpha plane
    // itself is exact everywhere, which is what the encoder has to preserve.
    const decoded = await pngPixels(bytes);
    for (let pixel = 0; pixel < 32; pixel += 1) {
      const offset = pixel * 4;
      expect(decoded[offset + 3]).toBe(pixels[offset + 3]);
      if (pixels[offset + 3] === 255) {
        expect(Array.from(decoded.subarray(offset, offset + 3))).toEqual(
          Array.from(pixels.subarray(offset, offset + 3)),
        );
      }
    }
  });

  it('encodes a one-pixel image', async () => {
    const pixels = new Uint8Array([12, 34, 56, 255]);
    const bytes = await encodePng({ data: pixels, width: 1, height: 1 }, deflateZlib);

    expect(pngSize(bytes)).toEqual({ width: 1, height: 1 });
    expect(Array.from(await pngPixels(bytes))).toEqual([12, 34, 56, 255]);
  });

  it('encodes a single column and a single row', async () => {
    // A single column has no left neighbour at all; a single row has no row
    // above. Both are the edges of the filter predictors.
    const column = new Uint8Array([
      10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 255,
    ]);
    const columnBytes = await encodePng({ data: column, width: 1, height: 4 }, deflateZlib);
    expect(Array.from(await pngPixels(columnBytes))).toEqual(Array.from(column));

    const row = new Uint8Array([9, 8, 7, 255, 1, 2, 3, 255, 4, 5, 6, 255]);
    const rowBytes = await encodePng({ data: row, width: 3, height: 1 }, deflateZlib);
    expect(Array.from(await pngPixels(rowBytes))).toEqual(Array.from(row));
  });

  it('picks the filter per row instead of one fixed filter', async () => {
    const canvas = texturedCanvas(64, 64);
    const captured: number[] = [];
    await encodeCanvasPng(canvas as unknown as PngCanvas, async (data) => {
      const stride = 64 * 3 + 1;
      for (let row = 0; row < 64; row += 1) captured.push(data[row * stride]);
      return data;
    });

    expect(new Set(captured).size).toBeGreaterThan(1);
  });

  it('compresses a textured raster better than the platform canvas encoder', async () => {
    const canvas = texturedCanvas(450, 700);
    const ours = await encodeCanvasPng(canvas as unknown as PngCanvas, deflateZlib);
    const platform = new Uint8Array(canvas.toBuffer('image/png'));
    expect(ours.length).toBeLessThan(platform.length * 0.9);
  });

  it('rejects a buffer that is neither RGB nor RGBA', async () => {
    await expect(
      encodePng({ data: new Uint8Array(10), width: 3, height: 3 }, identity),
    ).rejects.toThrow();
  });

  it('rejects a raster without positive dimensions', async () => {
    await expect(
      encodePng({ data: new Uint8Array(3), width: 0, height: 1 }, identity),
    ).rejects.toThrow();
  });

  it('encodes a 3-channel buffer as RGB', async () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const bytes = await encodePng({ data: pixels, width: 2, height: 2 }, deflateZlib);

    expect(ihdrOf(bytes).colorType).toBe(2);
    expect(Array.from(await pngPixels(bytes))).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
    ]);
  });

  it('detects an opaque alpha plane', () => {
    expect(isOpaqueRgba(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(true);
    expect(isOpaqueRgba(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(false);
  });
});
