/**
 * GIF decoding and encoding for the editor. Decoding composites every frame to
 * full size with the plain RGBA pixels, so the platform layer only has to turn
 * them into drawables. Encoding writes a self-contained GIF89a with one local
 * palette per frame, preserving delays and the Netscape loop count.
 */

import type { Rgb } from './color';
import { MIN_FRAME_DELAY_MS } from './document';

export type GifErrorCode = 'corrupt' | 'unsupported' | 'cancelled';

export class GifError extends Error {
  readonly code: GifErrorCode;

  constructor(code: GifErrorCode, message: string) {
    super(message);
    this.name = 'GifError';
    this.code = code;
  }
}

export interface DecodedGifFrame {
  /** Fully composited RGBA pixels, width × height × 4. */
  readonly pixels: Uint8ClampedArray;
  /** Frame delay in milliseconds, never below the 20 ms GIF floor. */
  readonly delayMs: number;
}

export interface DecodedGif {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly DecodedGifFrame[];
  /** Raw Netscape loop field; null when the file has no loop extension. */
  readonly loopCount: number | null;
}

export interface GifEncodeFrame {
  readonly pixels: Uint8ClampedArray;
  readonly delayMs: number;
}

export interface GifEncodeOptions {
  readonly width: number;
  readonly height: number;
  /** Raw Netscape loop field; null omits the extension (a single cycle). */
  readonly loopCount: number | null;
}

export interface GifEncodeHooks {
  readonly signal?: AbortSignal;
  /** Reports progress while frames are quantized, one call per frame. */
  readonly onProgress?: (done: number, total: number) => void;
}

/** The GIF timing floor, shared by decode, playback and encode. */
export const MIN_GIF_DELAY_MS = MIN_FRAME_DELAY_MS;

interface ColorCount extends Rgb {
  readonly count: number;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface GraphicControl {
  readonly disposal: number;
  readonly delayMs: number;
  readonly transparentIndex: number;
}

class Reader {
  private position: number;

  constructor(private readonly bytes: Uint8Array) {
    this.position = 0;
  }

  get done(): boolean {
    return this.position >= this.bytes.length;
  }

  byte(): number {
    if (this.position >= this.bytes.length) {
      throw new GifError('corrupt', 'GIF truncado.');
    }
    return this.bytes[this.position++];
  }

  uint16(): number {
    const low = this.byte();
    const high = this.byte();
    return low | (high << 8);
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.position + length > this.bytes.length) {
      throw new GifError('corrupt', 'GIF truncado.');
    }
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }
}

function readColorTable(bytes: Uint8Array, entries: number): Rgb[] {
  const table: Rgb[] = [];
  for (let index = 0; index < entries; index += 1) {
    const offset = index * 3;
    table.push({ r: bytes[offset], g: bytes[offset + 1], b: bytes[offset + 2] });
  }
  return table;
}

function readSubBlocks(reader: Reader): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  let size = reader.byte();
  while (size > 0) {
    blocks.push(reader.take(size));
    size = reader.byte();
  }
  return blocks;
}

function decodeLzw(minCodeSize: number, data: Uint8Array, expected: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const output = new Uint8Array(expected);
  let written = 0;

  let dictionary: Array<number[] | undefined> = [];
  let next = 0;
  let codeSize = 0;

  const reset = () => {
    dictionary = new Array(4096);
    for (let index = 0; index < clear; index += 1) dictionary[index] = [index];
    next = end + 1;
    codeSize = minCodeSize + 1;
  };
  reset();

  let bitBuffer = 0;
  let bitCount = 0;
  let position = 0;
  let previous: number[] | null = null;

  while (written < expected) {
    while (bitCount < codeSize) {
      if (position >= data.length) return output;
      bitBuffer |= data[position++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>= codeSize;
    bitCount -= codeSize;

    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === end) break;

    let entry: number[];
    const known = dictionary[code];
    if (known) {
      entry = known;
    } else if (code === next && previous) {
      entry = [...previous, previous[0]];
    } else {
      throw new GifError('corrupt', 'Código GIF inválido.');
    }

    for (const value of entry) {
      if (written >= expected) break;
      output[written++] = value;
    }

    if (previous && next < 4096) {
      dictionary[next] = [...previous, entry[0]];
      next += 1;
      // The decoder's table is one entry behind the encoder's, so it widens
      // when its own next code hits the power-of-two boundary.
      if (next === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
  }

  return output;
}

/** Rows in interlaced order, mapped to their real row in the frame. */
function interlacedRows(height: number): number[] {
  const rows: number[] = [];
  for (let y = 0; y < height; y += 8) rows.push(y);
  for (let y = 4; y < height; y += 8) rows.push(y);
  for (let y = 2; y < height; y += 4) rows.push(y);
  for (let y = 1; y < height; y += 2) rows.push(y);
  return rows;
}

function clearRect(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  rect: Rect,
): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    const offset = (y * canvasWidth + rect.x) * 4;
    pixels.fill(0, offset, offset + rect.width * 4);
  }
}

function drawFrame(
  pixels: Uint8ClampedArray,
  canvasWidth: number,
  canvasHeight: number,
  rect: Rect,
  indices: Uint8Array,
  palette: readonly Rgb[],
  transparentIndex: number,
  interlaced: boolean,
): void {
  const rows = interlaced ? interlacedRows(rect.height) : null;
  for (let row = 0; row < rect.height; row += 1) {
    const y = rect.y + (rows ? rows[row] : row);
    if (y < 0 || y >= canvasHeight) continue;
    for (let x = 0; x < rect.width; x += 1) {
      const targetX = rect.x + x;
      if (targetX < 0 || targetX >= canvasWidth) continue;
      const index = indices[row * rect.width + x];
      if (index === transparentIndex) continue;
      const color = palette[index];
      if (!color) continue;
      const offset = (y * canvasWidth + targetX) * 4;
      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = 255;
    }
  }
}

/**
 * Decode every frame of a GIF into composited RGBA pixels, honouring the
 * graphic-control disposal method (0/1 keep, 2 clear the frame rectangle,
 * 3 restore the canvas from before the frame was drawn).
 */
export function decodeGif(bytes: Uint8Array): DecodedGif {
  if (bytes.length < 13) {
    throw new GifError('corrupt', 'GIF truncado.');
  }
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    throw new GifError('unsupported', 'Arquivo não é um GIF.');
  }

  const reader = new Reader(bytes);
  reader.take(6);
  const width = reader.uint16();
  const height = reader.uint16();
  if (width <= 0 || height <= 0) {
    throw new GifError('corrupt', 'GIF sem dimensões válidas.');
  }
  const packed = reader.byte();
  reader.byte(); // background color index
  reader.byte(); // pixel aspect ratio
  const globalTable = (packed & 0x80) !== 0;
  const globalEntries = globalTable ? 1 << ((packed & 0x07) + 1) : 0;
  const globalColors = globalTable
    ? readColorTable(reader.take(globalEntries * 3), globalEntries)
    : [];

  const frames: DecodedGifFrame[] = [];
  let loopCount: number | null = null;
  let pending: GraphicControl = { disposal: 0, delayMs: 100, transparentIndex: -1 };
  let canvas: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(width * height * 4);
  let previousDisposal = 0;
  let previousRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  let previousSnapshot: Uint8ClampedArray<ArrayBuffer> | null = null;

  while (!reader.done) {
    const marker = reader.byte();
    if (marker === 0x3b) break;

    if (marker === 0x21) {
      const label = reader.byte();
      if (label === 0xf9) {
        const size = reader.byte();
        if (size < 4) throw new GifError('corrupt', 'Bloco de controle GIF inválido.');
        const control = reader.take(size);
        reader.byte(); // block terminator
        const disposal = (control[0] >> 2) & 0x07;
        const delayMs = Math.max(MIN_GIF_DELAY_MS, (control[1] | (control[2] << 8)) * 10);
        const transparent = (control[0] & 0x01) !== 0;
        pending = {
          disposal,
          delayMs,
          transparentIndex: transparent ? control[3] : -1,
        };
      } else {
        const blocks = readSubBlocks(reader);
        if (label === 0xff && blocks.length > 0) {
          const identifier = String.fromCharCode(...blocks[0]);
          if (identifier === 'NETSCAPE2.0' && blocks[1] && blocks[1][0] === 1) {
            loopCount = blocks[1][1] | (blocks[1][2] << 8);
          }
        }
      }
      continue;
    }

    if (marker !== 0x2c) {
      throw new GifError('corrupt', 'Bloco GIF desconhecido.');
    }

    const left = reader.uint16();
    const top = reader.uint16();
    const frameWidth = reader.uint16();
    const frameHeight = reader.uint16();
    const imagePacked = reader.byte();
    if (frameWidth <= 0 || frameHeight <= 0) {
      throw new GifError('corrupt', 'Quadro GIF sem dimensões válidas.');
    }
    const localTable = (imagePacked & 0x80) !== 0;
    const interlaced = (imagePacked & 0x40) !== 0;
    const localEntries = localTable ? 1 << ((imagePacked & 0x07) + 1) : 0;
    const palette = localTable
      ? readColorTable(reader.take(localEntries * 3), localEntries)
      : globalColors;
    const minCodeSize = reader.byte();
    if (minCodeSize < 2 || minCodeSize > 8) {
      throw new GifError('corrupt', 'Código de cor GIF inválido.');
    }
    const data = readSubBlocks(reader);

    // Apply the previous frame's disposal before this one is drawn.
    if (previousDisposal === 2) {
      clearRect(canvas, width, previousRect);
    } else if (previousDisposal === 3 && previousSnapshot) {
      canvas = previousSnapshot;
    }

    const snapshot = pending.disposal === 3 ? canvas.slice() : null;
    const indices = decodeLzw(minCodeSize, concatBlocks(data), frameWidth * frameHeight);
    drawFrame(
      canvas,
      width,
      height,
      { x: left, y: top, width: frameWidth, height: frameHeight },
      indices,
      palette,
      pending.transparentIndex,
      interlaced,
    );

    frames.push({ pixels: canvas.slice(), delayMs: pending.delayMs });

    previousDisposal = pending.disposal;
    previousRect = { x: left, y: top, width: frameWidth, height: frameHeight };
    previousSnapshot = snapshot;
    pending = { disposal: 0, delayMs: 100, transparentIndex: -1 };
  }

  if (frames.length === 0) {
    throw new GifError('corrupt', 'GIF sem quadros.');
  }
  return { width, height, frames, loopCount };
}

function concatBlocks(blocks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const block of blocks) length += block.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.length;
  }
  return output;
}

function colorKey(color: Rgb): number {
  return (color.r << 16) | (color.g << 8) | color.b;
}

function averageColor(colors: readonly ColorCount[]): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (const color of colors) {
    r += color.r * color.count;
    g += color.g * color.count;
    b += color.b * color.count;
    weight += color.count;
  }
  if (weight === 0) return { r: 0, g: 0, b: 0 };
  return {
    r: Math.round(r / weight),
    g: Math.round(g / weight),
    b: Math.round(b / weight),
  };
}

function medianCut(colors: readonly ColorCount[], maxColors: number): Rgb[] {
  let boxes: ColorCount[][] = [colors.slice()];

  const widest = (box: readonly ColorCount[]) => {
    let minR = 255;
    let minG = 255;
    let minB = 255;
    let maxR = 0;
    let maxG = 0;
    let maxB = 0;
    for (const color of box) {
      minR = Math.min(minR, color.r);
      minG = Math.min(minG, color.g);
      minB = Math.min(minB, color.b);
      maxR = Math.max(maxR, color.r);
      maxG = Math.max(maxG, color.g);
      maxB = Math.max(maxB, color.b);
    }
    const ranges = [maxR - minR, maxG - minG, maxB - minB];
    const channel = ranges.indexOf(Math.max(...ranges));
    return { channel, range: ranges[channel] };
  };

  while (boxes.length < maxColors) {
    let target = -1;
    let best = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      if (box.length < 2) continue;
      const { range } = widest(box);
      if (range > best) {
        best = range;
        target = index;
      }
    }
    if (target < 0) break;

    const box = boxes[target];
    const { channel } = widest(box);
    const sorted = [...box].sort((a, b) =>
      channel === 0 ? a.r - b.r : channel === 1 ? a.g - b.g : a.b - b.b,
    );
    const total = sorted.reduce((sum, color) => sum + color.count, 0);
    let accumulated = 0;
    let split = 1;
    for (let index = 0; index < sorted.length - 1; index += 1) {
      accumulated += sorted[index].count;
      split = index + 1;
      if (accumulated >= total / 2) break;
    }
    split = Math.min(sorted.length - 1, Math.max(1, split));
    boxes = [
      ...boxes.slice(0, target),
      sorted.slice(0, split),
      sorted.slice(split),
      ...boxes.slice(target + 1),
    ];
  }

  return boxes.filter((box) => box.length > 0).map(averageColor);
}

interface Quantized {
  readonly palette: Rgb[];
  readonly indices: Uint8Array;
  readonly transparentIndex: number | null;
}

function quantize(
  pixels: Uint8ClampedArray,
  maxColors: number,
): Quantized {
  const counts = new Map<number, ColorCount>();
  let hasTransparent = false;
  const pixelCount = Math.floor(pixels.length / 4);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (pixels[offset + 3] < 128) {
      hasTransparent = true;
      continue;
    }
    const color = { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] };
    const key = colorKey(color);
    const existing = counts.get(key);
    if (existing) {
      counts.set(key, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(key, { ...color, count: 1 });
    }
  }

  const opaque = [...counts.values()];
  const limit = hasTransparent ? Math.max(1, maxColors - 1) : maxColors;
  let palette: Rgb[];
  if (opaque.length === 0) {
    palette = [{ r: 0, g: 0, b: 0 }];
  } else if (opaque.length <= limit) {
    palette = opaque.map(({ r, g, b }) => ({ r, g, b }));
  } else {
    palette = medianCut(opaque, limit);
  }

  const indices = new Uint8Array(pixelCount);
  const exact = new Map<number, number>();
  palette.forEach((color, index) => {
    const key = colorKey(color);
    if (!exact.has(key)) exact.set(key, index);
  });
  const nearestCache = new Map<number, number>();
  const opaquePalette = palette;
  const transparentIndex = hasTransparent ? opaquePalette.length : null;
  if (transparentIndex !== null) palette = [...opaquePalette, { r: 0, g: 0, b: 0 }];

  const nearest = (r: number, g: number, b: number): number => {
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < opaquePalette.length; index += 1) {
      const color = opaquePalette[index];
      const dr = color.r - r;
      const dg = color.g - g;
      const db = color.b - b;
      const distance = dr * dr + dg * dg + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  };

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    if (pixels[offset + 3] < 128) {
      indices[pixel] = transparentIndex ?? 0;
      continue;
    }
    const key =
      (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
    const exactIndex = exact.get(key);
    if (exactIndex !== undefined) {
      indices[pixel] = exactIndex;
      continue;
    }
    let index = nearestCache.get(key);
    if (index === undefined) {
      index = nearest(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
      nearestCache.set(key, index);
    }
    indices[pixel] = index;
  }

  return { palette, indices, transparentIndex };
}

class Writer {
  private readonly bytes: number[] = [];

  byte(value: number): void {
    this.bytes.push(value & 0xff);
  }

  uint16(value: number): void {
    this.byte(value & 0xff);
    this.byte((value >> 8) & 0xff);
  }

  ascii(text: string): void {
    for (let index = 0; index < text.length; index += 1) {
      this.byte(text.charCodeAt(index));
    }
  }

  take(values: Uint8Array | readonly number[]): void {
    for (const value of values) this.byte(value);
  }

  finish(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const writer = new Writer();
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let dictionary = new Map<number, number>();

  const reset = () => {
    dictionary = new Map();
    next = end + 1;
    codeSize = minCodeSize + 1;
  };

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      writer.byte(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clear);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let index = 1; index < indices.length; index += 1) {
      const symbol = indices[index];
      const key = (prefix << 8) | symbol;
      const found = dictionary.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }

      emit(prefix);
      if (next < 4096) {
        dictionary.set(key, next);
        next += 1;
        // The decoder builds its table one entry behind the encoder, so the
        // wider code applies from the entry after the power-of-two boundary.
        if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize += 1;
      } else {
        emit(clear);
        reset();
      }
      prefix = symbol;
    }
    emit(prefix);
  }
  emit(end);
  if (bitCount > 0) writer.byte(bitBuffer & 0xff);
  return writer.finish();
}

function writeSubBlocks(writer: Writer, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    const size = Math.min(255, bytes.length - offset);
    writer.byte(size);
    writer.take(bytes.subarray(offset, offset + size));
    offset += size;
  }
  writer.byte(0);
}

function delayCentiseconds(delayMs: number): number {
  return Math.min(
    65535,
    Math.max(MIN_GIF_DELAY_MS / 10, Math.round(Math.max(0, delayMs) / 10)),
  );
}

function writeColorTable(writer: Writer, palette: readonly Rgb[], entries: number): void {
  for (let index = 0; index < entries; index += 1) {
    const color = palette[index] ?? { r: 0, g: 0, b: 0 };
    writer.byte(color.r);
    writer.byte(color.g);
    writer.byte(color.b);
  }
}

/**
 * Incremental GIF writer. Frames are quantized and written one at a time, so a
 * long video Export never holds every RGBA frame in memory.
 */
export class GifWriter {
  private readonly writer = new Writer();
  private readonly width: number;
  private readonly height: number;
  private readonly loopCount: number | null;
  private started = false;
  private ended = false;

  constructor(options: GifEncodeOptions) {
    this.width = Math.max(1, Math.round(options.width));
    this.height = Math.max(1, Math.round(options.height));
    this.loopCount = options.loopCount;
  }

  addFrame(frame: GifEncodeFrame): void {
    if (this.ended) throw new GifError('corrupt', 'O GIF já foi finalizado.');
    if (frame.pixels.length < this.width * this.height * 4) {
      throw new GifError('corrupt', 'Quadro menor que a dimensão do GIF.');
    }
    const quantized = quantize(frame.pixels, 256);
    if (!this.started) {
      this.writeHeader(quantized.palette);
      this.started = true;
    }

    const { palette, indices, transparentIndex } = quantized;
    const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));
    const tableSize = 1 << minCodeSize;

    this.writer.byte(0x21);
    this.writer.byte(0xf9);
    this.writer.byte(4);
    this.writer.byte(0x04 | (transparentIndex === null ? 0 : 0x01));
    this.writer.uint16(delayCentiseconds(frame.delayMs));
    this.writer.byte(transparentIndex ?? 0);
    this.writer.byte(0);

    this.writer.byte(0x2c);
    this.writer.uint16(0);
    this.writer.uint16(0);
    this.writer.uint16(this.width);
    this.writer.uint16(this.height);
    this.writer.byte(0x80 | (minCodeSize - 1));
    writeColorTable(this.writer, palette, tableSize);
    this.writer.byte(minCodeSize);
    writeSubBlocks(this.writer, lzwEncode(indices, minCodeSize));
  }

  finish(): Uint8Array {
    if (!this.started) {
      throw new GifError('corrupt', 'Não há quadros para codificar.');
    }
    if (!this.ended) {
      this.writer.byte(0x3b);
      this.ended = true;
    }
    return this.writer.finish();
  }

  private writeHeader(palette: readonly Rgb[]): void {
    this.writer.ascii('GIF89a');
    this.writer.uint16(this.width);
    this.writer.uint16(this.height);
    // A global table keeps every decoder happy; each image still carries a
    // local table, which is the one it actually uses.
    this.writer.byte(0xf7); // global table, 256 entries
    this.writer.byte(0);
    this.writer.byte(0);
    writeColorTable(this.writer, palette, 256);

    if (this.loopCount !== null) {
      this.writer.byte(0x21);
      this.writer.byte(0xff);
      this.writer.byte(11);
      this.writer.ascii('NETSCAPE2.0');
      this.writer.byte(3);
      this.writer.byte(1);
      this.writer.uint16(Math.min(65535, Math.max(0, Math.round(this.loopCount))));
      this.writer.byte(0);
    }
  }
}

/**
 * Encode fully rendered frames as an animated GIF. Each frame gets its own
 * local palette, delays use the 20 ms floor, and the loop count is written to
 * the Netscape extension so the result loops like the Source. Quantization is
 * asynchronous so a long animation can report progress and be cancelled.
 */
export async function encodeGif(
  frames: readonly GifEncodeFrame[],
  options: GifEncodeOptions,
  hooks: GifEncodeHooks = {},
): Promise<Uint8Array> {
  const writer = new GifWriter(options);
  for (let index = 0; index < frames.length; index += 1) {
    if (hooks.signal?.aborted) {
      throw new GifError('cancelled', 'Codificação cancelada.');
    }
    writer.addFrame(frames[index]);
    hooks.onProgress?.(index + 1, frames.length);
    // Let the progress notice paint and the cancel button respond.
    if (index + 1 < frames.length) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return writer.finish();
}
