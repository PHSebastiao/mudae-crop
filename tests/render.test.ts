import { createHash } from 'node:crypto';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  FIT_CROP,
  SQUARE_FRAME,
  defaultCrop,
  withCrop,
  withPadColor,
  type DocumentState,
  type Rotation,
} from '../src/core/document';
import { rotate90 } from '../src/core/geometry';
import { renderFrame } from '../src/core/render';
import { contextOf, makeDoc, makeSource } from './helpers';

/**
 * A deterministic fixture: quadrants aligned to the Frame so a 1:1 draw cannot
 * depend on interpolation. The hash is the render seam's snapshot.
 */
function fixtureSource() {
  return makeSource(225, 350, paintQuadrants);
}

function paintQuadrants(ctx: SKRSContext2D) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const left = Math.floor(width / 2);
  const top = Math.floor(height / 2);
  ctx.fillStyle = '#d94f6d';
  ctx.fillRect(0, 0, left, top);
  ctx.fillStyle = '#2b9c8f';
  ctx.fillRect(left, 0, width - left, top);
  ctx.fillStyle = '#f0d7a8';
  ctx.fillRect(0, top, left, height - top);
  ctx.fillStyle = '#23202c';
  ctx.fillRect(left, top, width - left, height - top);
}

function pixelsOf(canvas: Canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

function hashOf(doc: DocumentState, width: number, height: number): string {
  const canvas = createCanvas(width, height);
  renderFrame(contextOf(canvas), doc, { scale: 1 });
  return createHash('sha256').update(Buffer.from(pixelsOf(canvas))).digest('hex');
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
    expect(hashOf(doc, 225, 350)).toMatchSnapshot();
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

describe('Pad', () => {
  it('contains the Source and fills the bars with the Pad color', () => {
    const doc = withPadColor(
      withCrop(makeDoc(makeSource(400, 800)), defaultCrop('pad')),
      '#ff0000',
    );
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(10, 175, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx.getImageData(112, 175, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
    expect(Array.from(ctx.getImageData(214, 175, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });

  it('leaves Fit uncovered areas to the Source instead of the Pad color', () => {
    const doc = withPadColor(makeDoc(makeSource(400, 800)), '#ff0000');
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
    expect(Array.from(ctx.getImageData(2, 347, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
  });
});

describe('rotation', () => {
  function squareDoc(rotation: Rotation): DocumentState {
    const source = makeSource(350, 350, paintQuadrants);
    return {
      ...makeDoc(source),
      frame: SQUARE_FRAME,
      crop: defaultCrop('fit', rotation),
    };
  }

  it('turns the Source in 90° steps instead of resampling it', () => {
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), squareDoc(90), { scale: 1 });
    const ctx = canvas.getContext('2d');
    // Clockwise: the old bottom-left lands top-left.
    expect(Array.from(ctx.getImageData(10, 10, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(340, 10, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(340, 340, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(10, 340, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('produces the same pixels after four 90° steps, so blur never compounds', () => {
    const doc = makeDoc(fixtureSource());
    let crop = doc.crop;
    for (let step = 0; step < 4; step += 1) {
      crop = rotate90(doc, crop);
    }
    expect(crop).toEqual(FIT_CROP);
    const rotated = { ...doc, crop };
    expect(hashOf(rotated, 225, 350)).toBe(hashOf(doc, 225, 350));
  });

  it('renders a rotated Source into the Square Frame without stretching', () => {
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), squareDoc(180), { scale: 1 });
    const ctx = canvas.getContext('2d');
    // Half a turn swaps opposite quadrants.
    expect(Array.from(ctx.getImageData(10, 10, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
    expect(Array.from(ctx.getImageData(340, 340, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
  });
});
