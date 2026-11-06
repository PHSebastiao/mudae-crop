import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { FIT_CROP } from '../src/core/document';
import { renderFrame } from '../src/core/render';
import { contextOf, makeDoc, makeSource } from './helpers';

/**
 * A deterministic fixture: quadrants aligned to the Frame so a 1:1 draw cannot
 * depend on interpolation. The hash is the render seam's snapshot.
 */
function fixtureSource() {
  return makeSource(225, 350, (ctx) => {
    ctx.fillStyle = '#d94f6d';
    ctx.fillRect(0, 0, 112, 175);
    ctx.fillStyle = '#2b9c8f';
    ctx.fillRect(112, 0, 113, 175);
    ctx.fillStyle = '#f0d7a8';
    ctx.fillRect(0, 175, 112, 175);
    ctx.fillStyle = '#23202c';
    ctx.fillRect(112, 175, 113, 175);
  });
}

describe('render seam at 1×', () => {
  it('renders the Mudae Frame at exactly 225×350', () => {
    const doc = makeDoc(fixtureSource());
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const pixels = canvas.getContext('2d').getImageData(0, 0, 225, 350);
    expect(pixels.width).toBe(225);
    expect(pixels.height).toBe(350);
  });

  it('matches the committed snapshot for the fixture Source', () => {
    const doc = makeDoc(fixtureSource());
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const data = canvas.getContext('2d').getImageData(0, 0, 225, 350).data;
    const hash = createHash('sha256').update(Buffer.from(data)).digest('hex');
    expect(hash).toMatchSnapshot();
  });

  it('keeps fixture colors where the Crop puts them', () => {
    const doc = makeDoc(fixtureSource());
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(20, 20, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(200, 20, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(20, 320, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(200, 320, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('zooms around the Frame centre without stretching either axis', () => {
    const doc = {
      ...makeDoc(fixtureSource()),
      crop: { ...FIT_CROP, zoom: 2 },
    };
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const ctx = canvas.getContext('2d');
    // At 2× the Source overflows evenly on both axes, so the quadrant
    // boundaries (112 and 175 in Source space) land at −112 and 0 on screen.
    // The four corners therefore still show four different quadrants.
    expect(Array.from(ctx.getImageData(0, 0, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(224, 0, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(0, 349, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(224, 349, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });
});
