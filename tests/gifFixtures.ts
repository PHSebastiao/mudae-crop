/** A tiny, independent GIF writer used by the decoder tests. */

export interface GifFixtureFrame {
  readonly left?: number;
  readonly top?: number;
  readonly width: number;
  readonly height: number;
  readonly palette: ReadonlyArray<readonly [number, number, number]>;
  /** Row-major indices, length = width × height. */
  readonly indices: readonly number[];
  readonly delayCs?: number;
  readonly disposal?: number;
  readonly transparentIndex?: number;
  readonly interlace?: boolean;
}

/** GIF LZW, unused by the product encoder; keeps the fixtures independent. */
function lzw(indices: readonly number[], minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let dictionary = new Map<number, number>();
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];

  const reset = () => {
    dictionary = new Map();
    next = end + 1;
    codeSize = minCodeSize + 1;
  };
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 0xff);
      buffer >>= 8;
      bits -= 8;
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
  if (bits > 0) out.push(buffer & 0xff);
  return out;
}

export function buildGif(options: {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly GifFixtureFrame[];
  readonly loopCount?: number;
}): Uint8Array {
  const out: number[] = [];
  const byte = (value: number) => out.push(value & 0xff);
  const u16 = (value: number) => {
    byte(value);
    byte(value >> 8);
  };

  for (const char of 'GIF89a') byte(char.charCodeAt(0));
  u16(options.width);
  u16(options.height);
  byte(0x70); // no global table
  byte(0);
  byte(0);

  if (options.loopCount !== undefined) {
    byte(0x21);
    byte(0xff);
    byte(11);
    for (const char of 'NETSCAPE2.0') byte(char.charCodeAt(0));
    byte(3);
    byte(1);
    u16(options.loopCount);
    byte(0);
  }

  for (const frame of options.frames) {
    const transparent = frame.transparentIndex !== undefined;
    byte(0x21);
    byte(0xf9);
    byte(4);
    byte(((frame.disposal ?? 0) << 2) | (transparent ? 1 : 0));
    u16(frame.delayCs ?? 10);
    byte(frame.transparentIndex ?? 0);
    byte(0);

    byte(0x2c);
    u16(frame.left ?? 0);
    u16(frame.top ?? 0);
    u16(frame.width);
    u16(frame.height);
    const minCodeSize = Math.max(2, Math.ceil(Math.log2(Math.max(2, frame.palette.length))));
    const tableSize = 1 << minCodeSize;
    byte(0x80 | (frame.interlace ? 0x40 : 0) | (minCodeSize - 1));
    for (let index = 0; index < tableSize; index += 1) {
      const color = frame.palette[index] ?? [0, 0, 0];
      byte(color[0]);
      byte(color[1]);
      byte(color[2]);
    }
    byte(minCodeSize);
    const data = lzw(frame.indices, minCodeSize);
    let offset = 0;
    while (offset < data.length) {
      const size = Math.min(255, data.length - offset);
      byte(size);
      for (let index = 0; index < size; index += 1) byte(data[offset + index]);
      offset += size;
    }
    byte(0);
  }

  byte(0x3b);
  return new Uint8Array(out);
}

/** Read one pixel as [r, g, b, a] from composited RGBA pixels. */
export function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return Array.from(pixels.slice(offset, offset + 4));
}
