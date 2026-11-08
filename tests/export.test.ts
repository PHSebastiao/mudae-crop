import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  ExportError,
  renderPng,
  type EncodableCanvas,
  type ExportAdapter,
} from '../src/core/export';
import { renderFrame } from '../src/core/render';
import {
  SQUARE_FRAME,
  emptyDocument,
  withExportScale,
  withResize,
  withResizeLocked,
  type DocumentState,
} from '../src/core/document';
import { contextOf, makeDoc, makeSource, pngSize } from './helpers';

const adapter: ExportAdapter = {
  createCanvas(width: number, height: number): EncodableCanvas {
    return createCanvas(width, height) as unknown as EncodableCanvas;
  },
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    return new Uint8Array((canvas as unknown as Canvas).toBuffer('image/png'));
  },
};

describe('PNG Export', () => {
  it('writes a 225×350 PNG from the render seam at scale 1', async () => {
    const doc = makeDoc(makeSource(450, 700));
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 225, height: 350 });
  });

  it('produces exactly what the shared render entry point draws', async () => {
    const doc = makeDoc(makeSource(450, 700));
    const exported = await renderPng(doc, adapter);

    const reference = createCanvas(225, 350);
    renderFrame(contextOf(reference), doc, { scale: 1 });
    const expected = new Uint8Array(reference.toBuffer('image/png'));

    expect(Buffer.from(exported).equals(Buffer.from(expected))).toBe(true);
  });

  it('doubles the Mudae Frame to 450×700 for a 2× Export', async () => {
    const doc = withExportScale(makeDoc(makeSource(900, 1400)), 2);
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 450, height: 700 });
  });

  it('doubles the Square Frame to 700×700 for a 2× Export', async () => {
    const square: DocumentState = {
      ...withExportScale(makeDoc(makeSource(900, 900)), 2),
      frame: SQUARE_FRAME,
    };
    const bytes = await renderPng(square, adapter);
    expect(pngSize(bytes)).toEqual({ width: 700, height: 700 });
  });

  it('draws the 2× Export from the Source at that size, not from a 1× render', async () => {
    const doc = {
      ...withExportScale(makeDoc(makeSource(900, 1400)), 2),
      crop: { mode: 'fit' as const, zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 as const },
    };
    const exported = await renderPng(doc, adapter);

    const reference = createCanvas(450, 700);
    renderFrame(contextOf(reference), doc, { scale: 2 });
    const expected = new Uint8Array(reference.toBuffer('image/png'));

    expect(Buffer.from(exported).equals(Buffer.from(expected))).toBe(true);
  });

  it('refuses to export an empty document', async () => {
    await expect(renderPng(emptyDocument(), adapter)).rejects.toBeInstanceOf(ExportError);
  });

  it('writes an arbitrary resized Export at its exact dimensions', async () => {
    const doc = withResize(withResizeLocked(makeDoc(makeSource(450, 700)), false), {
      width: 100,
      height: 50,
    });
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 100, height: 50 });
  });

  it('keeps the Frame proportion while the resize lock is on', async () => {
    const doc = withResize(makeDoc(makeSource(450, 700)), { width: 100, height: 50 });
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 100, height: 156 });
  });
});
