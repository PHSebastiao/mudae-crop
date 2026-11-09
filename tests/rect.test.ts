import { describe, expect, it } from 'vitest';
import { withCrop } from '../src/core/document';
import { MUDAE_RATIO } from '../src/core/ratios';
import { STAGE_PAD, resizeRect, stageLayout, stageView, type Handle } from '../src/core/rect';
import { makeDoc, makeSource } from './helpers';

const BOUNDS = { width: 2000, height: 2000 };
const RATIO = MUDAE_RATIO;
const HEIGHT = 500 / RATIO;
const RECT = { x: 750, y: 1000 - HEIGHT / 2, width: 500, height: HEIGHT };

function expectRect(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.width).toBeCloseTo(expected.width);
  expect(actual.height).toBeCloseTo(expected.height);
}

describe('resizeRect', () => {
  const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const shrinkDeltas: Record<Handle, { dx: number; dy: number }> = {
    nw: { dx: 40, dy: 40 },
    n: { dx: 0, dy: 30 },
    ne: { dx: -40, dy: -40 },
    e: { dx: -40, dy: 0 },
    se: { dx: -40, dy: -40 },
    s: { dx: 0, dy: -30 },
    sw: { dx: 40, dy: 40 },
    w: { dx: 40, dy: 0 },
  };

  it('keeps the opposite edge or corner anchored for every locked handle', () => {
    for (const handle of HANDLES) {
      const { dx, dy } = shrinkDeltas[handle];
      const { rect } = resizeRect(BOUNDS, RATIO, RECT, handle, dx, dy, true, 'fit');
      const east = handle.includes('e');
      const west = handle.includes('w');
      const north = handle.includes('n');
      const south = handle.includes('s');

      expect(rect.width).toBeLessThan(RECT.width);
      expect(rect.width / rect.height).toBeCloseTo(RATIO);
      if (east) expect(rect.x).toBeCloseTo(RECT.x);
      if (west) expect(rect.x + rect.width).toBeCloseTo(RECT.x + RECT.width);
      if (north) expect(rect.y + rect.height).toBeCloseTo(RECT.y + RECT.height);
      if (south) expect(rect.y).toBeCloseTo(RECT.y);
      if (!east && !west) {
        expect(rect.x + rect.width / 2).toBeCloseTo(RECT.x + RECT.width / 2);
      }
      if (!north && !south) {
        expect(rect.y + rect.height / 2).toBeCloseTo(RECT.y + RECT.height / 2);
      }
    }
  });

  it('keeps every free handle on its dragged axis and anchor', () => {
    for (const handle of HANDLES) {
      const east = handle.includes('e');
      const west = handle.includes('w');
      const north = handle.includes('n');
      const south = handle.includes('s');
      const dx = east ? 20 : west ? 20 : 0;
      const dy = south ? 20 : north ? 20 : 0;
      const { rect, ratio } = resizeRect(BOUNDS, RATIO, RECT, handle, dx, dy, false, 'fit');

      expect(ratio).toBeCloseTo(rect.width / rect.height);
      if (east) expect(rect.x).toBeCloseTo(RECT.x);
      if (west) expect(rect.x + rect.width).toBeCloseTo(RECT.x + RECT.width);
      if (north) expect(rect.y + rect.height).toBeCloseTo(RECT.y + RECT.height);
      if (south) expect(rect.y).toBeCloseTo(RECT.y);
      if (!east && !west) expect(rect.width).toBeCloseTo(RECT.width);
      if (!north && !south) expect(rect.height).toBeCloseTo(RECT.height);
    }
  });

  it('anchors the opposite edge and keeps the ratio on a locked edge drag', () => {
    const east = resizeRect(BOUNDS, RATIO, RECT, 'e', -40, 0, true, 'fit');
    expectRect(east.rect, {
      x: 750,
      y: 1000 - 460 / RATIO / 2,
      width: 460,
      height: 460 / RATIO,
    });

    const south = resizeRect(BOUNDS, RATIO, RECT, 's', 0, -30, true, 'fit');
    expectRect(south.rect, {
      x: 1000 - (747.7778 * RATIO) / 2,
      y: RECT.y,
      width: 747.7778 * RATIO,
      height: 747.7778,
    });
  });

  it('anchors the opposite corner and follows the larger relative drag', () => {
    const se = resizeRect(BOUNDS, RATIO, RECT, 'se', -50, -50, true, 'fit');
    expectRect(se.rect, { x: 750, y: RECT.y, width: 450, height: 450 / RATIO });

    const nw = resizeRect(BOUNDS, RATIO, RECT, 'nw', 50, 50, true, 'fit');
    expectRect(nw.rect, {
      x: 800,
      y: RECT.y + RECT.height - 450 / RATIO,
      width: 450,
      height: 450 / RATIO,
    });
    expect(nw.rect.x + nw.rect.width).toBeCloseTo(RECT.x + RECT.width);
    expect(nw.rect.y + nw.rect.height).toBeCloseTo(RECT.y + RECT.height);
  });

  it('freezes the perpendicular axis on a free edge drag', () => {
    const east = resizeRect(BOUNDS, RATIO, RECT, 'e', 20, 0, false, 'fit');
    expect(east.rect.width).toBeCloseTo(520);
    expect(east.rect.height).toBeCloseTo(RECT.height);
    expect(east.ratio).toBeCloseTo(520 / RECT.height);
  });

  it('anchors the opposite corner and returns the new ratio on a free corner drag', () => {
    const se = resizeRect(BOUNDS, RATIO, RECT, 'se', 100, 50, false, 'fit');
    expectRect(se.rect, {
      x: RECT.x,
      y: RECT.y,
      width: 600,
      height: RECT.height + 50,
    });
    expect(se.ratio).toBeCloseTo(600 / (RECT.height + 50));

    const nw = resizeRect(BOUNDS, RATIO, RECT, 'nw', 50, 30, false, 'fit');
    expect(nw.rect.x + nw.rect.width).toBeCloseTo(RECT.x + RECT.width);
    expect(nw.rect.y + nw.rect.height).toBeCloseTo(RECT.y + RECT.height);
  });

  it('clamps a locked drag to the 8× minimum and the Fit rect maximum', () => {
    const fitWidth = Math.min(BOUNDS.width, BOUNDS.height * RATIO);

    const tiny = resizeRect(BOUNDS, RATIO, RECT, 'e', -400, 0, true, 'fit');
    expect(tiny.rect.width).toBeCloseTo(fitWidth / 8);
    expect(tiny.rect.width / tiny.rect.height).toBeCloseTo(RATIO);

    const huge = resizeRect(BOUNDS, RATIO, RECT, 'e', 10_000, 0, true, 'fit');
    expect(huge.rect.width).toBeCloseTo(fitWidth);
    expect(huge.rect.width / huge.rect.height).toBeCloseTo(RATIO);
  });

  it('lets Pad grow as far as the Pad rect', () => {
    const huge = resizeRect(BOUNDS, RATIO, RECT, 'e', 10_000, 0, true, 'pad');

    expect(huge.rect.width).toBeCloseTo(2000);
    expect(huge.rect.width / huge.rect.height).toBeCloseTo(RATIO);
  });

  it('does nothing for non-finite input or a size past the anchor', () => {
    expect(resizeRect(BOUNDS, RATIO, RECT, 'e', Number.NaN, 0, true, 'fit')).toEqual({
      rect: RECT,
      ratio: RATIO,
    });
    expect(resizeRect(BOUNDS, RATIO, RECT, 'e', -600, 0, true, 'fit')).toEqual({
      rect: RECT,
      ratio: RATIO,
    });
  });
});

describe('stageLayout', () => {
  const stage = { width: 400, height: 400 };
  const available = 232;

  it('fills the stage with the Frame outside the adjust phase', () => {
    const doc = makeDoc(makeSource(1000, 1000), 1);
    const layout = stageLayout(doc, stage, 1, false);

    expect(layout.scale).toBeCloseTo(available / 1000);
    expect(layout.frameWidth).toBeCloseTo(available);
    expect(layout.frameHeight).toBeCloseTo(available);
    expect(layout.frameLeft).toBe(STAGE_PAD);
    expect(layout.frameTop).toBe(STAGE_PAD);
    expect(layout.sceneWidth).toBeCloseTo(400);
    expect(layout.sceneHeight).toBeCloseTo(400);
    expect(layout.framePixelWidth).toBe(available);
  });

  it('shows the whole Source and offsets the Frame while adjusting', () => {
    const doc = withCrop(makeDoc(makeSource(1000, 1000), 1), {
      mode: 'fit',
      rect: { x: 100, y: 200, width: 400, height: 400 },
      rotation: 0,
    });
    const layout = stageLayout(doc, stage, 1, true);
    const scale = available / 1000;

    expect(layout.adjusting).toBe(true);
    expect(layout.view.viewWidth).toBe(1000);
    expect(layout.scale).toBeCloseTo(scale);
    expect(layout.frameWidth).toBeCloseTo(Math.round(400 * scale));
    expect(layout.frameLeft).toBeCloseTo(STAGE_PAD + 100 * scale);
    expect(layout.frameTop).toBeCloseTo(STAGE_PAD + 200 * scale);
    expect(layout.sceneWidth).toBeCloseTo(400);
  });

  it('uses the Frame ratio for the empty stage', () => {
    const doc = makeDoc(null);
    const layout = stageLayout(doc, stage, 1, false);

    expect(layout.scale).toBe(0);
    expect(layout.frameWidth).toBeCloseTo(available * MUDAE_RATIO);
    expect(layout.frameHeight).toBeCloseTo(available);
    expect(layout.frameLeft).toBe(STAGE_PAD);
    expect(layout.frameTop).toBe(STAGE_PAD);
  });

  it('rounds the backing canvases to whole device pixels', () => {
    const doc = makeDoc(makeSource(1000, 1000), 1);
    const layout = stageLayout(doc, stage, 1.5, false);

    expect(layout.framePixelWidth).toBe(Math.round(layout.frameWidth * 1.5));
    expect(layout.framePixelHeight).toBe(Math.round(layout.frameHeight * 1.5));
    expect(layout.scenePixelWidth).toBe(Math.round(layout.sceneWidth * 1.5));
    expect(layout.scenePixelHeight).toBe(Math.round(layout.sceneHeight * 1.5));
  });
});

describe('stageView', () => {
  const bounds = { width: 1000, height: 2000 };

  it('uses the Frame as the view outside the adjust phase', () => {
    const view = stageView(bounds, { x: 100, y: 200, width: 400, height: 800 }, false);
    expect(view).toEqual({ originX: 0, originY: 0, viewWidth: 400, viewHeight: 800 });
  });

  it('uses the whole Source while adjusting when the Frame is inside it', () => {
    const view = stageView(bounds, { x: 100, y: 200, width: 400, height: 800 }, true);
    expect(view).toEqual({ originX: 0, originY: 0, viewWidth: 1000, viewHeight: 2000 });
  });

  it('extends to a Pad window that is larger than the Source', () => {
    const rect = { x: -100, y: -50, width: 1200, height: 2100 };
    const view = stageView(bounds, rect, true);
    expect(view.originX).toBe(-100);
    expect(view.originY).toBe(-50);
    expect(view.viewWidth).toBe(1200);
    expect(view.viewHeight).toBe(2100);
  });
});
