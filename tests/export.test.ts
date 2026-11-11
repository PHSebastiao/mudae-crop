import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { ExportError, renderPng } from '../src/core/export';
import { renderFrame } from '../src/core/render';
import { emptyDocument, withResize, withResizeLocked } from '../src/core/document';
import {
  contextOf,
  makeDoc,
  makeSource,
  pngPixels,
  pngSize,
  testExportAdapter as adapter,
} from './helpers';

describe('PNG Export', () => {
  it('writes a 225×350 PNG at the native crop size', async () => {
    const doc = makeDoc(makeSource(225, 350));
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 225, height: 350 });
  });

  it('produces exactly what the shared render entry point draws', async () => {
    const doc = makeDoc(makeSource(225, 350));
    const exported = await renderPng(doc, adapter);

    const reference = createCanvas(225, 350);
    renderFrame(contextOf(reference), doc, { outputWidth: 225, outputHeight: 350 });
    const expected = reference.getContext('2d').getImageData(0, 0, 225, 350).data;

    expect(Buffer.from(await pngPixels(exported)).equals(Buffer.from(expected))).toBe(true);
  });

  it('writes the canonical Carta 2× size from an explicit resize', async () => {
    const doc = withResize(makeDoc(makeSource(450, 700)), { width: 450, height: 700 });
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 450, height: 700 });
  });

  it('writes a custom square resize at its exact size', async () => {
    const doc = withResize(makeDoc(makeSource(700, 700), 1), { width: 1400, height: 1400 });
    const bytes = await renderPng(doc, adapter);
    expect(pngSize(bytes)).toEqual({ width: 1400, height: 1400 });
  });

  it('draws the resized Export from the Source at that size, not from a 1× render', async () => {
    const doc = withResize(makeDoc(makeSource(450, 700)), { width: 450, height: 700 });
    const exported = await renderPng(doc, adapter);

    const reference = createCanvas(450, 700);
    renderFrame(contextOf(reference), doc, { outputWidth: 450, outputHeight: 700 });
    const expected = reference.getContext('2d').getImageData(0, 0, 450, 700).data;

    expect(Buffer.from(await pngPixels(exported)).equals(Buffer.from(expected))).toBe(true);
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
