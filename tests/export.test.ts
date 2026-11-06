import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { ExportError, renderPng, type EncodableCanvas, type ExportAdapter } from '../src/core/export';
import { renderFrame } from '../src/core/render';
import { emptyDocument } from '../src/core/document';
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
    const bytes = await renderPng(doc, 1, adapter);
    expect(pngSize(bytes)).toEqual({ width: 225, height: 350 });
  });

  it('produces exactly what the shared render entry point draws', async () => {
    const doc = makeDoc(makeSource(450, 700));
    const exported = await renderPng(doc, 1, adapter);

    const reference = createCanvas(225, 350);
    renderFrame(contextOf(reference), doc, { scale: 1 });
    const expected = new Uint8Array(reference.toBuffer('image/png'));

    expect(Buffer.from(exported).equals(Buffer.from(expected))).toBe(true);
  });

  it('refuses to export an empty document', async () => {
    await expect(renderPng(emptyDocument(), 1, adapter)).rejects.toBeInstanceOf(ExportError);
  });
});
