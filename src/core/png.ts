/**
 * The app's own PNG writer. The platform canvas encoder writes one fixed row
 * filter and an alpha plane even when every pixel is opaque, which costs about
 * a third of a photo Export; this writer picks the best filter per row and
 * drops the alpha channel when it carries no information. Deflate is injected
 * so the module stays platform-free.
 */

/** A zlib (RFC 1950) compressor, supplied by the platform. */
export type PngDeflate = (data: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;

/** The readback the encoder needs from a canvas. */
export interface PngCanvas {
  readonly width: number;
  readonly height: number;
  getContext(type: '2d'): {
    getImageData(
      x: number,
      y: number,
      width: number,
      height: number,
    ): { readonly data: Uint8ClampedArray };
  };
}

/** The pixels to encode: 3 channels for RGB, 4 for RGBA. */
export interface PngPixels {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** 2 is truecolour RGB, 6 is truecolour with alpha. Both are 8-bit. */
export type PngColorType = 2 | 6;

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const toLeft = Math.abs(estimate - left);
  const toAbove = Math.abs(estimate - above);
  const toUpperLeft = Math.abs(estimate - upperLeft);
  if (toLeft <= toAbove && toLeft <= toUpperLeft) return left;
  return toAbove <= toUpperLeft ? above : upperLeft;
}

/** True when every alpha byte is 255, so the plane can be dropped. */
export function isOpaqueRgba(data: ArrayLike<number>): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) return false;
  }
  return true;
}

/**
 * Prefix every row with the filter that leaves the smallest residuals. PNG
 * filters predict a byte from its left neighbour, the byte above, or both; the
 * signature of a residual is measured as its absolute value, so a negative
 * residual costs what it is worth. This is the heuristic libpng uses.
 */
function filterScanlines(
  source: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array<ArrayBuffer> {
  const stride = width * bpp;
  const out = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride + 1));
  const costs = new Int32Array(5);
  const noRow = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    const above = y === 0 ? noRow : source.subarray(rowStart - stride, rowStart);
    for (let type = 0; type < 5; type += 1) {
      const candidate = candidates[type];
      candidate[0] = type;
      let cost = 0;
      for (let i = 0; i < stride; i += 1) {
        const value = source[rowStart + i];
        const left = i >= bpp ? source[rowStart + i - bpp] : 0;
        const up = above[i];
        let residual: number;
        if (type === 0) residual = value;
        else if (type === 1) residual = value - left;
        else if (type === 2) residual = value - up;
        else if (type === 3) residual = value - ((left + up) >> 1);
        else residual = value - paeth(left, up, i >= bpp ? above[i - bpp] : 0);
        const byte = residual & 0xff;
        candidate[i + 1] = byte;
        cost += byte < 128 ? byte : 256 - byte;
      }
      costs[type] = cost;
    }
    let best = 0;
    for (let type = 1; type < 5; type += 1) {
      if (costs[type] < costs[best]) best = type;
    }
    const outStart = y * (stride + 1);
    out[outStart] = best;
    out.set(candidates[best].subarray(1), outStart + 1);
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((length, part) => length + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encode 8-bit RGB or RGBA pixels as a PNG. An opaque RGBA image is written as
 * RGB: the alpha plane would be one constant byte per pixel, which filters and
 * deflate cannot make free, and it also breaks the byte distance the other
 * filters measure across channels.
 */
export async function encodePng(pixels: PngPixels, deflate: PngDeflate): Promise<Uint8Array> {
  const { data, width, height } = pixels;
  if (!(width > 0) || !(height > 0)) {
    throw new Error('A PNG precisa de dimensões positivas.');
  }
  const channels = data.length / (width * height);
  if (channels !== 3 && channels !== 4) {
    throw new Error('A PNG precisa de 3 ou 4 canais por pixel.');
  }
  const source =
    data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.length);

  const colorType: PngColorType = channels === 4 && !isOpaqueRgba(source) ? 6 : 2;
  const raw = colorType === 2 && channels === 4 ? dropAlpha(source, width * height) : source;

  const filtered = filterScanlines(raw, width, height, colorType === 2 ? 3 : 4);
  const compressed = await deflate(filtered);

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = colorType;
  // Compression 0, filter method 0 and no interlace are the only PNG values
  // worth writing; the remaining bytes stay zero.

  return concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function dropAlpha(source: Uint8Array, pixelCount: number): Uint8Array {
  const rgb = new Uint8Array(pixelCount * 3);
  for (let pixel = 0, target = 0; pixel < pixelCount; pixel += 1, target += 3) {
    const start = pixel * 4;
    rgb[target] = source[start];
    rgb[target + 1] = source[start + 1];
    rgb[target + 2] = source[start + 2];
  }
  return rgb;
}

/**
 * Read a canvas back as pixels and encode it. Async so a readback failure (a
 * tainted canvas throws) rejects instead of throwing out of a promise-returning
 * call.
 */
export async function encodeCanvasPng(canvas: PngCanvas, deflate: PngDeflate): Promise<Uint8Array> {
  const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return encodePng({ data: image.data, width: canvas.width, height: canvas.height }, deflate);
}
