import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it, vi } from 'vitest';
import {
  ExportError,
  exportKindFor,
  renderGif,
  type EncodableCanvas,
  type ExportAdapter,
  type RenderProgress,
} from '../src/core/export';
import { decodeGif } from '../src/core/gif';
import { DEFAULT_OPTIMIZE, withTrim, withTrimEnabled } from '../src/core/document';
import type { GifOptimizer } from '../src/core/optimize';
import { makeAnimatedSource, makeDoc, makeSource } from './helpers';

const adapter: ExportAdapter = {
  createCanvas(width: number, height: number): EncodableCanvas {
    return createCanvas(width, height) as unknown as EncodableCanvas;
  },
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    return new Uint8Array((canvas as unknown as Canvas).toBuffer('image/png'));
  },
};

/** Read dimensions, frame delays and the Netscape loop straight from the bytes. */
function readGifMetadata(bytes: Uint8Array): {
  width: number;
  height: number;
  delays: number[];
  loopCount: number | null;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const packed = bytes[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));

  const delays: number[] = [];
  let loopCount: number | null = null;

  const skipSubBlocks = () => {
    let size = bytes[offset++];
    while (size > 0) {
      offset += size;
      size = bytes[offset++];
    }
  };

  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[offset++];
      if (label === 0xf9) {
        const size = bytes[offset++];
        const delay = view.getUint16(offset + 1, true) * 10;
        if (size > 0) delays.push(delay);
        offset += size + 1; // block bytes + terminator
      } else if (label === 0xff) {
        const size = bytes[offset++];
        const identifier = String.fromCharCode(...bytes.subarray(offset, offset + size));
        offset += size;
        const blockSize = bytes[offset++];
        if (identifier === 'NETSCAPE2.0' && blockSize === 3 && bytes[offset] === 1) {
          loopCount = view.getUint16(offset + 1, true);
        }
        offset += blockSize;
        if (bytes[offset] === 0) offset += 1;
      } else {
        skipSubBlocks();
      }
      continue;
    }
    if (marker === 0x2c) {
      const imagePacked = bytes[offset + 8];
      offset += 9;
      if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
      offset += 1; // minimum code size
      skipSubBlocks();
      continue;
    }
    break;
  }

  return { width, height, delays, loopCount };
}

describe('GIF Export', () => {
  const source = makeAnimatedSource(
    225,
    350,
    ['#D94F6D', '#2B9C8F', '#F0D7A8', '#23202C'],
    [80, 120, 40, 60],
    2,
  );

  it('chooses GIF for an animation and PNG for a still', () => {
    expect(exportKindFor(source)).toMatchObject({
      format: 'gif',
      label: 'GIF',
      contentType: 'image/gif',
    });
    expect(exportKindFor(makeSource(10, 10))).toMatchObject({
      format: 'png',
      label: 'PNG',
      contentType: 'image/png',
    });
    expect(exportKindFor(source, 'png').format).toBe('png');
    expect(exportKindFor(makeSource(10, 10), 'gif').format).toBe('png');
    expect(exportKindFor(null).format).toBe('png');
  });

  it('exports the Frame dimensions and only the trimmed frames', async () => {
    const doc = withTrimEnabled(withTrim(makeDoc(source), { start: 1, end: 2 }), true);

    const bytes = await renderGif(doc, adapter);
    const decoded = decodeGif(bytes);

    expect(decoded.width).toBe(225);
    expect(decoded.height).toBe(350);
    expect(decoded.frames).toHaveLength(2);
  });

  it('preserves the delays with the 20 ms floor and the loop count', async () => {
    const short = makeAnimatedSource(225, 350, ['#D94F6D', '#2B9C8F'], [5, 250], 0);
    const doc = withTrimEnabled(withTrim(makeDoc(short), { start: 0, end: 1 }), true);

    const bytes = await renderGif(doc, adapter);
    const decoded = decodeGif(bytes);

    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([20, 250]);
    expect(decoded.loopCount).toBe(0);

    // Also read the structures directly, so the assertion does not depend only
    // on the project's own decoder.
    expect(readGifMetadata(bytes)).toEqual({
      width: 225,
      height: 350,
      delays: [20, 250],
      loopCount: 0,
    });
  });

  it('merges consecutive duplicate frames with the Optimize off', async () => {
    const duplicate = makeAnimatedSource(225, 350, ['#D94F6D', '#D94F6D', '#2B9C8F'], [100, 50, 80], 0);
    const doc = makeDoc(duplicate);

    const decoded = decodeGif(await renderGif(doc, adapter));

    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([150, 80]);
    expect(decoded.loopCount).toBe(0);
  });

  it('reports progress across rendering and streaming encoding', async () => {
    const onProgress = vi.fn();
    const doc = withTrimEnabled(withTrim(makeDoc(source), { start: 0, end: 2 }), true);

    await renderGif(doc, adapter, { onProgress });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { phase: 'render', done: 1, total: 3 },
      { phase: 'render', done: 2, total: 3 },
      { phase: 'render', done: 3, total: 3 },
    ]);
  });

  it('stops without bytes when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const attempt = renderGif(
      withTrimEnabled(withTrim(makeDoc(source), { start: 0, end: 1 }), true),
      adapter,
      {
        signal: controller.signal,
      },
    );

    await expect(attempt).rejects.toBeInstanceOf(ExportError);
    await expect(attempt).rejects.toMatchObject({ cancelled: true });
  });

  it('can cancel during the frame loop', async () => {
    const controller = new AbortController();
    const doc = withTrimEnabled(withTrim(makeDoc(source), { start: 0, end: 2 }), true);

    const attempt = renderGif(doc, adapter, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.phase === 'render' && progress.done >= 2) controller.abort();
      },
    });

    await expect(attempt).rejects.toMatchObject({ cancelled: true });
  });

  it('flushes the merged pending frame when the last frames are duplicates', async () => {
    const duplicate = makeAnimatedSource(
      225,
      350,
      ['#D94F6D', '#2B9C8F', '#2B9C8F'],
      [100, 50, 80],
      0,
    );
    const doc = {
      ...makeDoc(duplicate),
      optimize: { ...DEFAULT_OPTIMIZE, enabled: true },
    };

    const decoded = decodeGif(await renderGif(doc, adapter));

    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([100, 130]);
  });

  it('cancels between rendering and finishing after the pending flush', async () => {
    const controller = new AbortController();
    const doc = {
      ...makeDoc(source),
      optimize: { ...DEFAULT_OPTIMIZE, enabled: true },
    };

    const attempt = renderGif(doc, adapter, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.done === progress.total) controller.abort();
      },
    });

    await expect(attempt).rejects.toMatchObject({ cancelled: true });
  });

  it('cancels while optimizing and never reports an optimized result', async () => {
    const controller = new AbortController();
    const onOptimized = vi.fn();
    const optimizer: GifOptimizer = {
      async compress() {
        controller.abort();
        return new Uint8Array(0);
      },
    };
    const doc = {
      ...makeDoc(source),
      optimize: { ...DEFAULT_OPTIMIZE, enabled: true, targetEnabled: true, targetBytes: 1 },
    };

    const attempt = renderGif(doc, adapter, {
      signal: controller.signal,
      optimizer,
      onOptimized,
    });

    await expect(attempt).rejects.toMatchObject({ cancelled: true });
    expect(onOptimized).not.toHaveBeenCalled();
  });

  it('reports optimize progress after the render progress', async () => {
    const progress: RenderProgress[] = [];
    const optimizer: GifOptimizer = { compress: async (bytes) => bytes };
    const doc = {
      ...makeDoc(source),
      optimize: { ...DEFAULT_OPTIMIZE, enabled: true, targetEnabled: true },
    };

    await renderGif(doc, adapter, {
      optimizer,
      onProgress: (next) => progress.push(next),
    });

    expect(progress.slice(0, 4)).toEqual([
      { phase: 'render', done: 1, total: 4 },
      { phase: 'render', done: 2, total: 4 },
      { phase: 'render', done: 3, total: 4 },
      { phase: 'render', done: 4, total: 4 },
    ]);
    // The base already fits the default target, so the chosen pass runs once.
    expect(progress[4]).toEqual({ phase: 'optimize', done: 1, total: 1 });
    expect(progress).toHaveLength(5);
  });

  it('refuses a still Source and an empty document', async () => {
    await expect(renderGif(makeDoc(makeSource(10, 10)), adapter)).rejects.toMatchObject({
      message: 'A Source não é animada.',
    });
    await expect(renderGif(makeDoc(null), adapter)).rejects.toMatchObject({
      message: 'Não há Source para exportar.',
    });
  });
});
