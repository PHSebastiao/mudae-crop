import { createHash } from 'node:crypto';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BORDER,
  withBorder,
  withCrop,
  withPadColor,
  withSharpness,
  type DocumentState,
  type Rotation,
} from '../src/core/document';
import { panBy, rotate90, zoomAt } from '../src/core/geometry';
import { drawSource, frameBorderStroke, renderFrame } from '../src/core/render';
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
  renderFrame(contextOf(canvas), doc, { outputWidth: width, outputHeight: height });
  return createHash('sha256')
    .update(Buffer.from(pixelsOf(canvas)))
    .digest('hex');
}

describe('render seam at 1×', () => {
  it('renders a Mudae-proportion output at exactly 225×350', () => {
    const doc = makeDoc(fixtureSource());
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { outputWidth: 225, outputHeight: 350 });
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
    renderFrame(contextOf(canvas), doc, { outputWidth: 225, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(20, 20, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(200, 20, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(20, 320, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(200, 320, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('zooms around a Source point without stretching either axis', () => {
    const doc = makeDoc(fixtureSource());
    const zoomed = {
      ...doc,
      crop: zoomAt(doc, doc.crop, 2, { x: 112.5, y: 175 }),
    };
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), zoomed, { outputWidth: 225, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    // At 2× the Source overflows evenly on both axes, so the quadrant
    // boundaries land outside the Frame and its four corners still show four
    // different quadrants.
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(222, 2, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(2, 347, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(222, 347, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('draws the surround at the Frame origin, so it continues the Crop exactly', () => {
    // 25px bands: a shifted origin lands on a different band, so a wrong origin
    // cannot pass this by luck.
    const source = makeSource(400, 400, (ctx) => {
      const colors = ['#d94f6d', '#2b9c8f', '#f0d7a8', '#23202c'];
      for (let band = 0; band < 16; band += 1) {
        ctx.fillStyle = colors[band % colors.length];
        ctx.fillRect(band * 25, 0, 25, 400);
      }
    });
    const doc = withCrop(makeDoc(source, 9 / 14), {
      mode: 'fit',
      rect: { x: 50, y: 20, width: 200, height: 200 / (9 / 14) },
      rotation: 0,
    });
    const width = 100;
    const height = Math.round(100 / (9 / 14));
    const frameCanvas = createCanvas(width, height);
    renderFrame(contextOf(frameCanvas), doc, {
      outputWidth: width,
      outputHeight: height,
      border: false,
    });

    const origin = 20;
    const scene = createCanvas(width + origin * 2, height + origin * 2);
    drawSource(
      contextOf(scene),
      doc,
      width / doc.crop.rect.width,
      height / doc.crop.rect.height,
      origin,
      origin,
    );

    const framePixels = frameCanvas.getContext('2d').getImageData(0, 0, width, height).data;
    const scenePixels = scene.getContext('2d').getImageData(origin, origin, width, height).data;
    expect(Buffer.from(scenePixels).equals(Buffer.from(framePixels))).toBe(true);
  });
});

describe('Pad', () => {
  it('contains the Source and fills the bars with the Pad color', () => {
    const doc = withPadColor(makeDoc(makeSource(400, 800), 9 / 14, 'pad'), '#ff0000');
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { outputWidth: 225, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(10, 175, 1, 1).data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(ctx.getImageData(112, 175, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
    expect(Array.from(ctx.getImageData(214, 175, 1, 1).data)).toEqual([255, 0, 0, 255]);
  });

  it('leaves Fit uncovered areas to the Source instead of the Pad color', () => {
    const doc = withPadColor(makeDoc(makeSource(400, 800)), '#ff0000');
    const canvas = createCanvas(225, 350);
    renderFrame(contextOf(canvas), doc, { outputWidth: 225, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
    expect(Array.from(ctx.getImageData(2, 347, 1, 1).data)).toEqual([0x33, 0x55, 0xaa, 255]);
  });
});

describe('rotation', () => {
  function squareDoc(rotation: Rotation): DocumentState {
    const source = makeSource(350, 350, paintQuadrants);
    return makeDoc(source, 1, 'fit', rotation);
  }

  it('turns the Source in 90° steps instead of resampling it', () => {
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), squareDoc(90), { outputWidth: 350, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    // Clockwise: the old bottom-left lands top-left.
    expect(Array.from(ctx.getImageData(10, 10, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(340, 10, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(340, 340, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(Array.from(ctx.getImageData(10, 340, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('produces the same pixels after four 90° steps, so blur never compounds', () => {
    const doc = squareDoc(0);
    let crop = doc.crop;
    for (let step = 0; step < 4; step += 1) {
      crop = rotate90(doc, crop);
    }
    expect(crop.rotation).toBe(0);
    expect(crop).toEqual(doc.crop);
    const rotated = { ...doc, crop };
    expect(hashOf(rotated, 350, 350)).toBe(hashOf(doc, 350, 350));
  });

  it('renders a rotated Source into the Square Frame without stretching', () => {
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), squareDoc(180), { outputWidth: 350, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    // Half a turn swaps opposite quadrants.
    expect(Array.from(ctx.getImageData(10, 10, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
    expect(Array.from(ctx.getImageData(340, 340, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
  });

  it('keeps the quadrant mapping under a non-uniform export', () => {
    const doc = makeDoc(makeSource(400, 400, paintQuadrants), 1, 'fit', 90);
    const canvas = createCanvas(200, 400);
    renderFrame(contextOf(canvas), doc, { outputWidth: 200, outputHeight: 400 });
    const ctx = canvas.getContext('2d');
    // Clockwise: BL → TL, TL → TR, BR → BL, TR → BR.
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(Array.from(ctx.getImageData(197, 2, 1, 1).data)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(Array.from(ctx.getImageData(2, 397, 1, 1).data)).toEqual([0x23, 0x20, 0x2c, 255]);
    expect(Array.from(ctx.getImageData(197, 397, 1, 1).data)).toEqual([0x2b, 0x9c, 0x8f, 255]);
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
    // At the left pan limit the Source's edge sits on the Frame's edge, so the
    // rotated border must be visible there.
    const doc = makeDoc(source, 1, 'fit', 90);
    const panned = { ...doc, crop: panBy(doc, doc.crop, -10_000, 0) };
    const canvas = createCanvas(350, 350);
    renderFrame(contextOf(canvas), panned, { outputWidth: 350, outputHeight: 350 });
    const ctx = canvas.getContext('2d');
    expect(Array.from(ctx.getImageData(2, 175, 1, 1).data)).toEqual([0xff, 0x00, 0xff, 255]);
    expect(Array.from(ctx.getImageData(2, 2, 1, 1).data)).toEqual([0xff, 0x00, 0xff, 255]);
    expect(Array.from(ctx.getImageData(100, 175, 1, 1).data)).toEqual([0x80, 0x80, 0x80, 255]);
  });
});

describe('deliberate stretch', () => {
  /**
   * A square fixture stretched into a 1:2 raster. The two axis factors differ,
   * so a canvas that scaled uniformly could not reproduce these samples.
   */
  function stretchedDoc(): DocumentState {
    return makeDoc(makeSource(400, 400, paintQuadrants), 1, 'fit');
  }

  function line(
    ctx: SKRSContext2D,
    axis: 'row' | 'column',
    fixed: number,
    length: number,
  ): number[][] {
    return Array.from({ length }, (_, index) =>
      axis === 'row' ? pixel(ctx, index, fixed) : pixel(ctx, fixed, index),
    );
  }

  it('repeats the per-axis factor at 2× of a stretched export', () => {
    const doc = stretchedDoc();
    const once = createCanvas(200, 400);
    renderFrame(contextOf(once), doc, { outputWidth: 200, outputHeight: 400, border: false });
    const twice = createCanvas(400, 800);
    renderFrame(contextOf(twice), doc, { outputWidth: 400, outputHeight: 800, border: false });

    const onceCtx = once.getContext('2d');
    const twiceCtx = twice.getContext('2d');

    // All four quadrants survive the extra factor on each axis.
    expect(pixel(twiceCtx, 20, 20)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(pixel(twiceCtx, 380, 20)).toEqual([0x2b, 0x9c, 0x8f, 255]);
    expect(pixel(twiceCtx, 20, 780)).toEqual([0xf0, 0xd7, 0xa8, 255]);
    expect(pixel(twiceCtx, 380, 780)).toEqual([0x23, 0x20, 0x2c, 255]);

    // Away from the quadrant boundary the 2× raster is the 1× one doubled.
    for (const [x, y] of [
      [60, 120],
      [140, 120],
      [60, 280],
      [140, 280],
    ]) {
      expect(pixel(twiceCtx, x * 2, y * 2)).toEqual(pixel(onceCtx, x, y));
    }

    // The quadrant boundaries stay on the raster midlines: a uniform scale
    // would put the vertical one at 200/600 instead of 400. The high-quality
    // smoothing bleeds a few pixels, so follow a channel across its midpoint.
    const firstCrossing = (colors: number[][], channel: number, from: number, to: number) => {
      const middle = (from + to) / 2;
      return colors.findIndex((color) =>
        to > from ? color[channel] > middle : color[channel] < middle,
      );
    };
    const row = line(twiceCtx, 'row', 100, 400);
    const column = line(twiceCtx, 'column', 100, 800);
    expect(firstCrossing(row, 0, 0xd9, 0x2b)).toBe(200);
    expect(firstCrossing(column, 1, 0x4f, 0xd7)).toBe(400);
  });
});

function renderContext(
  doc: DocumentState,
  width: number,
  height: number,
  scale = 1,
): SKRSContext2D {
  const canvas = createCanvas(width, height);
  renderFrame(contextOf(canvas), doc, {
    outputWidth: width * scale,
    outputHeight: height * scale,
    border: { scale, minPx: 1 },
  });
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

  it('scales the Preview Border with the display scale', () => {
    const doc = makeDoc(fixtureSource());
    const one = renderContext(doc, 225, 350, 1);
    const two = renderContext(doc, 225, 350, 2);

    // At 1× only pixel 0 is Border; at 2× the 2px stroke covers 0 and 1.
    expect(pixel(one, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(one, 1, 1)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(pixel(two, 1, 1)).toEqual([255, 255, 255, 255]);
    expect(pixel(two, 2, 2)).toEqual([0xd9, 0x4f, 0x6d, 255]);
  });

  it('draws the Border at its width in output pixels at any size', () => {
    const doc = makeDoc(makeSource(450, 700, paintQuadrants));
    const canvas = createCanvas(450, 700);
    // No preview border scale: this is the real Export path.
    renderFrame(contextOf(canvas), doc, { outputWidth: 450, outputHeight: 700 });
    const ctx = canvas.getContext('2d');

    expect(pixel(ctx, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 1, 1)).not.toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 0, 350)).toEqual([255, 255, 255, 255]);
  });

  it('clamps a scaled-down Preview Border to one canvas pixel', () => {
    const doc = makeDoc(makeSource(450, 700, paintQuadrants));
    const canvas = createCanvas(450, 700);
    renderFrame(contextOf(canvas), doc, {
      outputWidth: 450,
      outputHeight: 700,
      border: { scale: 0.5, minPx: 1 },
    });
    const ctx = canvas.getContext('2d');

    expect(pixel(ctx, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(ctx, 1, 1)).not.toEqual([255, 255, 255, 255]);
  });

  it('draws nothing when the width is 0', () => {
    const doc = withBorder(makeDoc(fixtureSource()), { width: 0 });
    const ctx = renderContext(doc, 225, 350);

    expect(pixel(ctx, 0, 0)).toEqual([0xd9, 0x4f, 0x6d, 255]);
    expect(pixel(ctx, 224, 349)).toEqual([0x23, 0x20, 0x2c, 255]);
  });

  it('shares one preview stroke formula with the adjust overlay', () => {
    const doc = withBorder(makeDoc(makeSource(450, 700, paintQuadrants)), { width: 2 });

    expect(frameBorderStroke(doc, 225, 450)).toBe(1);
    expect(frameBorderStroke(doc, 900, 450)).toBe(4);
    expect(frameBorderStroke(doc, 450, 450)).toBe(2);
    expect(frameBorderStroke(withBorder(doc, { width: 0 }), 900, 450)).toBe(0);
  });

  it('stays aligned to the Frame when the Source is rotated', () => {
    const doc = withBorder(makeDoc(makeSource(350, 350, paintQuadrants), 1, 'fit', 90), {
      color: '#FF0000',
      width: 4,
    });
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
