import { createHash } from 'node:crypto';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BORDER,
  FIT_CROP,
  SQUARE_FRAME,
  defaultCrop,
  withBorder,
  withCrop,
  withPadColor,
  withSharpness,
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
  return createHash('sha256')
    .update(Buffer.from(pixelsOf(canvas)))
    .digest('hex');
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
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(222, 2, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(2, 347, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(222, 347, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
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

  it('draws the rotated bitmap at the Crop scale, not the output scale', () => {
    const source = makeSource(400, 800, (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, 400, 800);
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, 400, 20);
      ctx.fillRect(0, 780, 400, 20);
      ctx.fillRect(0, 0, 20, 800);
      ctx.fillRect(380, 0, 20, 800);
    });
    // At the right pan limit the Source's left edge sits on the Frame's left
    // edge, so the rotated border must be visible there. The old path drew it
    // with the output scale, pushing the edge far outside the Frame.
    const doc = {
      ...makeDoc(source),
      frame: SQUARE_FRAME,
      crop: { ...defaultCrop('fit', 90), offsetX: 175 },
    };
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), doc, { scale: 1 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(2, 175, 1, 1).data)).toEqual([0xff, 0x00, 0xff, 255]);
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0xff, 0x00, 0xff, 255]);
    expect(Array.from(ctx.getImageData(100, 175, 1, 1).data)).toEqual([0x80, 0x80, 0x80, 255]);
  });
});

function renderContext(
  doc: DocumentState,
  width: number,
  height: number,
  scale = 1,
): SKRSContext2D {
  const canvas = createCanvas(width, height);
  renderFrame(contextOf(canvas), doc, { scale });
  return canvas.getContext('2d');
}

function pixel(ctx: SKRSContext2D, x: number, y: number): number[] {
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

describe('Border', () => {
  it('draws the default 1px white Border inside the Frame', () => {
    const doc = makeDoc(fixtureSource());
    expect(doc.border).toEqual(DEFAULT_BORDER);

    const ctx = renderContext(doc, 225, 350);

    expect(pixel(ctx, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 0, 175)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 112, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 224, 349)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 1, 1)).toEqual([0xd9, 0x4f, 0x6d, 255]);
  });

  it('scales the Border width with the Export scale', () => {
    const doc = makeDoc(fixtureSource());
    const one = renderContext(doc, 225, 350, 1);
    const two = renderContext(doc, 450, 700, 2);

    // At 1× only pixel 0 is Border; at 2× the 2px stroke covers 0 and 1.
    expect(pixel(one, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(one, 1, 1)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(pixel(two, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(two, 2, 2)).toEqual([0xd9, 0x4f, 0x6d, 255]);
  });

  it('draws nothing when the width is 0', () => {
    const doc = withBorder(makeDoc(fixtureSource()), { width: 0 });
    const ctx = renderContext(doc, 225, 350);

    expect(pixel(ctx, 0, 0)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(pixel(ctx, 224, 349)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('stays aligned to the Frame when the Source is rotated', () => {
    const doc = {
      ...withBorder(makeDoc(makeSource(350, 350, paintQuadrants)), {
        color: '#FF0000',
        width: 4,
      }),
      frame: SQUARE_FRAME,
      crop: defaultCrop('fit', 90),
    };
    const ctx = renderContext(doc, 350, 350);

    expect(pixel(ctx, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 175, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 349, 175)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 6, 6)).toEqual([0xf0, 0xd7, 0xa8, 255]);
  });
});

describe('Sharpness', () => {
  function edgeDoc(): DocumentState {
    const source = makeSource(225, 350, (ctx) => {
      ctx.fillStyle = '#282828';
      ctx.fillRect(0, 0, 112, 350);
      ctx.fillStyle = '#C8C8C8';
      ctx.fillRect(112, 0, 113, 350);
    });
    return makeDoc(source);
  }

  it('sharpens the rendered Crop before the Border', () => {
    const flat = renderContext(edgeDoc(), 225, 350);
    const sharp = renderContext(withSharpness(edgeDoc(), 100), 225, 350);

    expect(pixel(sharp, 111, 175)[0]).toBeLessThan(pixel(flat, 111, 175)[0]);
    expect(pixel(sharp, 112, 175)[0]).toBeGreaterThan(pixel(flat, 112, 175)[0]);

    const bordered = withBorder(withSharpness(edgeDoc(), 100), {
      color: '#FF0000',
      width: 4,
    });
    const ctx = renderContext(bordered, 225, 350);
    expect(pixel(ctx, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(ctx, 3, 3)).toEqual([255, 0, 0, 255]);
  });

  it('is deterministic and a no-op at 0', () => {
    const doc = edgeDoc();
    expect(hashOf(withSharpness(doc, 0), 225, 350)).toBe(hashOf(doc, 225, 350));
    expect(hashOf(withSharpness(edgeDoc(), 60), 225, 350)).toBe(
      hashOf(withSharpness(edgeDoc(), 60), 225, 350),
    );
  });
});
