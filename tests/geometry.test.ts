import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME,
  defaultCrop,
  withBorder,
  withCrop,
  withPadColor,
  withResize,
  withResizeLocked,
} from '../src/core/document';
import {
  applyRatio,
  applyScaleMode,
  baseRectFor,
  centreSnapAxes,
  clampCrop,
  dragPan,
  dragResize,
  frameRect,
  nativeSize,
  offsetPct,
  panBy,
  resetCrop,
  resizeCrop,
  resizeFrame,
  rotate90,
  rotatedBounds,
  startDrag,
  zoomAt,
  zoomOf,
  zoomTo,
} from '../src/core/geometry';
import { MUDAE_RATIO } from '../src/core/ratios';
import { padRect } from '../src/core/rect';
import { makeDoc, makeSource } from './helpers';

function expectRect(
  actual: { x: number; y: number; width: number; height: number },
  expected: { x: number; y: number; width: number; height: number },
) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.width).toBeCloseTo(expected.width);
  expect(actual.height).toBeCloseTo(expected.height);
}

describe('rect per mode', () => {
  it('fits a portrait Source inside the Frame ratio', () => {
    const doc = makeDoc(makeSource(400, 800));
    expectRect(frameRect(doc), {
      x: 0,
      y: (800 - 400 / MUDAE_RATIO) / 2,
      width: 400,
      height: 400 / MUDAE_RATIO,
    });
    expect(zoomOf(doc)).toBeCloseTo(1);
  });

  it('pads a portrait Source, letting the rect exceed the Source width', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'pad');
    expectRect(frameRect(doc), {
      x: (400 - 800 * MUDAE_RATIO) / 2,
      y: 0,
      width: 800 * MUDAE_RATIO,
      height: 800,
    });
  });

  it('snaps to the Source width in Full width', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'full-width');
    expectRect(frameRect(doc), {
      x: 0,
      y: (800 - 400 / MUDAE_RATIO) / 2,
      width: 400,
      height: 400 / MUDAE_RATIO,
    });
  });

  it('snaps to the Source height in Full height and lets the rect exceed the width', () => {
    const doc = makeDoc(makeSource(800, 400), MUDAE_RATIO, 'full-height');
    expectRect(frameRect(doc), {
      x: (800 - 400 * MUDAE_RATIO) / 2,
      y: 0,
      width: 400 * MUDAE_RATIO,
      height: 400,
    });
  });

  it('fills a square Frame from any Source aspect', () => {
    const doc = makeDoc(makeSource(800, 400), 1);
    expectRect(frameRect(doc), { x: 200, y: 0, width: 400, height: 400 });
    expectRect(frameRect(makeDoc(makeSource(800, 400), 1, 'pad')), {
      x: 0,
      y: -200,
      width: 800,
      height: 800,
    });
  });

  it('never gives the rect a different ratio from the Frame', () => {
    const doc = makeDoc(makeSource(1234, 567));
    const rect = frameRect(doc);
    expect(rect.width / rect.height).toBeCloseTo(MUDAE_RATIO);
  });
});

describe('rotation', () => {
  it('swaps the bounds of a portrait Source at 90°', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'fit', 90);
    expect(rotatedBounds(doc)).toEqual({ width: 800, height: 400 });
    expectRect(frameRect(doc), {
      x: (800 - 400 * MUDAE_RATIO) / 2,
      y: 0,
      width: 400 * MUDAE_RATIO,
      height: 400,
    });
  });

  it('cycles through the four steps and keeps the rect ratio', () => {
    const doc = makeDoc(makeSource(400, 800));
    let crop = doc.crop;
    const steps = [90, 180, 270, 0];
    for (const expected of steps) {
      crop = rotate90(doc, crop);
      expect(crop.rotation).toBe(expected);
      expect(crop.rect.width / crop.rect.height).toBeCloseTo(MUDAE_RATIO);
    }
    expect(crop.rotation).toBe(0);
  });

  it('keeps a centred rect centred and unsquashed in the new bounds', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'fit', 90);
    const rect = frameRect(doc);
    expect(rect.width / rect.height).toBeCloseTo(MUDAE_RATIO);
    expect(rect.x + rect.width / 2).toBeCloseTo(800 / 2);
    expect(rect.y + rect.height / 2).toBeCloseTo(400 / 2);
  });

  it('clamps a maxed-out window when the rotation swaps the bounds', () => {
    // The Fit rect of 400×800 is 400×622; after the swap it cannot fit the 400
    // height, so the clamp shrinks it. Documented in ADR-0005.
    const doc = makeDoc(makeSource(400, 800));
    const rotated = rotate90(doc, doc.crop);
    expect(rotated.rect.height).toBeCloseTo(400);
    expect(rotated.rect.width).toBeCloseTo(400 * MUDAE_RATIO);
    expect(rotated.rect.width / rotated.rect.height).toBeCloseTo(MUDAE_RATIO);
  });
});

describe('zoom', () => {
  it('keeps Fit from growing past the Fit rect or shrinking below 1/8', () => {
    const doc = makeDoc(makeSource(400, 800));

    const grown = clampCrop(doc, {
      ...doc.crop,
      rect: { ...doc.crop.rect, width: doc.crop.rect.width * 2 },
    });
    expect(zoomOf({ ...doc, crop: grown })).toBeCloseTo(1);

    const shrunk = clampCrop(doc, {
      ...doc.crop,
      rect: { ...doc.crop.rect, width: doc.crop.rect.width / 100 },
    });
    expect(zoomOf({ ...doc, crop: shrunk })).toBeCloseTo(8);
    expect(shrunk.rect.width).toBeCloseTo(frameRect(doc).width / 8);
  });

  it('lets a Pad crop grow as far as the Pad rect', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'pad');
    const pad = padRect({ width: 400, height: 800 }, MUDAE_RATIO);

    const zoomedOut = clampCrop(doc, {
      ...doc.crop,
      rect: { ...doc.crop.rect, width: doc.crop.rect.width * 100 },
    });
    expect(zoomOf({ ...doc, crop: zoomedOut })).toBeCloseTo(1);
    expect(zoomedOut.rect.width).toBeCloseTo(pad.width);
  });

  it('lets a snap mode shrink only as far as the Pad rect', () => {
    const doc = makeDoc(makeSource(800, 400), MUDAE_RATIO, 'full-height');
    const pad = padRect({ width: 800, height: 400 }, MUDAE_RATIO);
    const minZoom = baseRectFor(doc).width / pad.width;

    const zoomedOut = clampCrop(doc, {
      ...doc.crop,
      rect: { ...doc.crop.rect, width: doc.crop.rect.width * 100 },
    });
    expect(zoomOf({ ...doc, crop: zoomedOut })).toBeCloseTo(minZoom);
    expect(zoomedOut.rect.width).toBeCloseTo(pad.width);
  });

  it('scales the rect about the Source point under the pointer', () => {
    const doc = makeDoc(makeSource(400, 800));
    const point = { x: 200, y: 400 };
    const before = frameRect(doc);
    const zoomed = zoomAt(doc, doc.crop, 2.5, point);
    const after = zoomed.rect;

    expect(after.width).toBeCloseTo(before.width / 2.5);
    expect((point.x - after.x) / after.width).toBeCloseTo((point.x - before.x) / before.width);
    expect((point.y - after.y) / after.height).toBeCloseTo((point.y - before.y) / before.height);
  });

  it('clamps the rect after a zoom near the edge', () => {
    const doc = makeDoc(makeSource(800, 400));
    const crop = zoomAt(doc, doc.crop, 2, { x: 0, y: 0 });
    expect(crop.rect.x).toBeGreaterThanOrEqual(0);
    expect(crop.rect.y).toBeGreaterThanOrEqual(0);
    expect(crop.rect.x + crop.rect.width).toBeLessThanOrEqual(800);
    expect(crop.rect.y + crop.rect.height).toBeLessThanOrEqual(400);
  });
});

describe('pan', () => {
  it('moves the rect by Source pixels and clamps it inside the Source', () => {
    const doc = makeDoc(makeSource(800, 400));
    const panned = panBy(doc, doc.crop, 10_000, 10_000);
    expect(panned.rect.x).toBeCloseTo(800 - panned.rect.width);
    expect(panned.rect.y).toBeCloseTo(0);

    const left = clampCrop(doc, {
      ...doc.crop,
      rect: { ...doc.crop.rect, x: -10_000 },
    });
    expect(left.rect.x).toBeCloseTo(0);
  });

  it('allows no pan when Source and Frame aspect match', () => {
    const doc = makeDoc(makeSource(450, 700));
    const panned = panBy(doc, doc.crop, 30, -30);
    expect(panned.rect.x).toBeCloseTo(0);
    expect(panned.rect.y).toBeCloseTo(0);
  });

  it('uses the rotated bounds for the pan limits', () => {
    const doc = makeDoc(makeSource(800, 400), MUDAE_RATIO, 'fit', 90);
    const panned = panBy(doc, doc.crop, 0, 10_000);
    expect(panned.rect.x).toBeCloseTo(0);
    expect(panned.rect.y + panned.rect.height).toBeCloseTo(800);
  });

  it('does not let a Pad rect drift inside its bars', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'pad');
    const panned = panBy(doc, doc.crop, 30, -30);
    expectRect(panned.rect, frameRect(doc));
  });

  it('snaps the window centre to the Source centre within the threshold', () => {
    const doc = makeDoc(makeSource(800, 400));
    const off = panBy(doc, doc.crop, -40, 0);
    const centre = (crop: typeof off) => crop.rect.x + crop.rect.width / 2;
    expect(centre(off)).toBeCloseTo(360);

    const snapped = panBy({ ...doc, crop: off }, off, 36, 0, {
      snapCenter: true,
      threshold: 6,
    });
    expect(centre(snapped)).toBeCloseTo(400);

    const released = panBy({ ...doc, crop: off }, off, 36, 0, {
      snapCenter: false,
      threshold: 6,
    });
    expect(centre(released)).toBeCloseTo(396);

    const far = panBy({ ...doc, crop: off }, off, 10, 0, {
      snapCenter: true,
      threshold: 6,
    });
    expect(centre(far)).toBeCloseTo(370);
  });

  it('reports the axes a pan would hold at the centre', () => {
    const doc = makeDoc(makeSource(800, 400));
    const off = panBy(doc, doc.crop, -40, 0);
    const bounds = rotatedBounds({ ...doc, crop: off });

    expect(centreSnapAxes(bounds, off.rect, 0, 0, 6)).toEqual({ x: false, y: true });
    expect(centreSnapAxes(bounds, off.rect, 36, 0, 6)).toEqual({ x: true, y: true });
    expect(centreSnapAxes(bounds, off.rect, 10, 0, 6)).toEqual({ x: false, y: true });
  });
});

describe('pan drag snap', () => {
  const doc = makeDoc(makeSource(800, 400));
  const bounds = rotatedBounds(doc);
  const centreX = (crop: typeof doc.crop) => crop.rect.x + crop.rect.width / 2;
  const centre = bounds.width / 2;

  // One continuous drag from the document's Frame, one entry per pointer event.
  function pan(steps: readonly number[], threshold = 6) {
    let anchor = startDrag(doc);
    let crop = doc.crop;
    for (const step of steps) {
      const result = dragPan(doc, anchor, step, 0, { snapCentre: true, threshold });
      anchor = result.anchor;
      crop = result.crop;
    }
    return crop;
  }

  it('holds the centre until the pointer has travelled the threshold', () => {
    // Six 1 px events stay inside a 6 px threshold: the Frame does not move.
    expect(centreX(pan([1, 1, 1, 1, 1, 1]))).toBeCloseTo(centre);
    // The seventh crosses it, so the Frame follows the whole travel at once.
    expect(centreX(pan([1, 1, 1, 1, 1, 1, 1]))).toBeCloseTo(centre + 7);
  });

  it('escapes by travel, not by event size', () => {
    // A fast 5 px flick stays snapped, exactly as five slow 1 px events do.
    expect(centreX(pan([5]))).toBeCloseTo(centre);
    expect(centreX(pan([1, 1, 1, 1, 1]))).toBeCloseTo(centre);
    // The same 9 px of travel escapes once, whichever way it arrives.
    const fast = pan([9]);
    const slow = pan([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const chunks = pan([4, 4, 1]);
    expect(centreX(fast)).toBeCloseTo(centre + 9);
    expect(centreX(slow)).toBeCloseTo(centre + 9);
    expect(centreX(chunks)).toBeCloseTo(centre + 9);
  });

  it('snaps back to the centre when a drag comes within the threshold', () => {
    const off = panBy(doc, doc.crop, -20, 0);
    const result = dragPan({ ...doc, crop: off }, startDrag({ ...doc, crop: off }), 16, 0, {
      snapCentre: true,
      threshold: 6,
    });
    expect(centreX(result.crop)).toBeCloseTo(centre);
  });

  it('follows the pointer back at once after being clamped at the edge', () => {
    // Pushed far past the Source's left edge, then 5 px back: the Frame moves
    // at once instead of first unwinding the overshoot.
    const far = dragPan(doc, startDrag(doc), -10_000, 0, {
      snapCentre: true,
      threshold: 6,
    });
    expect(far.crop.rect.x).toBeCloseTo(0);
    const back = dragPan(doc, far.anchor, 5, 0, { snapCentre: true, threshold: 6 });
    expect(back.crop.rect.x).toBeCloseTo(5);
  });

  it('does not pull to the centre when the snap is off', () => {
    const off = panBy(doc, doc.crop, -40, 0);
    const result = dragPan({ ...doc, crop: off }, startDrag({ ...doc, crop: off }), 16, 0, {
      snapCentre: false,
      threshold: 6,
    });
    expect(centreX(result.crop)).toBeCloseTo(centre - 24);
  });
});

describe('resize drag snap', () => {
  const doc = makeDoc(makeSource(2000, 1000));
  const startRatio = doc.frame.ratio;
  const options = { locked: false, snap: true, startRatio };

  // One continuous 3:2 drag of the east edge, one entry per pointer event.
  function resize(steps: readonly number[]) {
    let anchor = startDrag(doc);
    let crop = doc.crop;
    let ratio = doc.frame.ratio;
    for (const step of steps) {
      const result = dragResize(doc, anchor, 'e', step, 0, options);
      anchor = result.anchor;
      crop = result.crop;
      ratio = result.ratio;
    }
    return { crop, ratio, anchor };
  }

  it('lands on a preset from one fast event or many slow ones', () => {
    const wide = 3 / 2;
    // The 3:2 width, in one event and in a hundred.
    const travel = 1000 * wide - doc.crop.rect.width;
    const fast = resize([travel]);
    const slow = resize(Array.from({ length: 100 }, () => travel / 100));
    expect(fast.ratio).toBeCloseTo(wide);
    expect(slow.ratio).toBeCloseTo(wide);
    expect(fast.crop.rect.width).toBeCloseTo(1000 * wide);
    expect(slow.crop.rect.width).toBeCloseTo(1000 * wide);
  });

  it('lets a slow drag leave a preset after the tolerance', () => {
    // Straight from Mudae to a free 1.4499: the drag passes 4:3 and must let go
    // of it, which a per-event snap never did.
    const travel = 807;
    const slow = resize(Array.from({ length: travel }, () => 1));
    expect(slow.ratio).toBeCloseTo((doc.crop.rect.width + travel) / 1000);
    // The same travel in one event reaches the same raw ratio.
    const fast = resize([travel]);
    expect(fast.ratio).toBeCloseTo(slow.ratio);
    expect(fast.crop.rect.width).toBeCloseTo(slow.crop.rect.width);
  });

  it('holds one fast event that lands inside the tolerance', () => {
    // 20 px past the 3:2 width is a 1.52 ratio, still within 3%.
    const travel = 1000 * 1.5 - doc.crop.rect.width + 20;
    const fast = resize([travel]);
    const slow = resize(Array.from({ length: 100 }, () => travel / 100));
    expect(fast.ratio).toBeCloseTo(3 / 2);
    expect(fast.crop.rect.width).toBeCloseTo(1500);
    expect(slow.ratio).toBeCloseTo(3 / 2);
    expect(slow.crop.rect.width).toBeCloseTo(1500);
  });

  it('keeps the snapped preset when a free drag locks', () => {
    // Shift held to a 3:2 capture, then released without moving: the locked drag
    // holds what is on screen, not the raw ratio the snap was measuring from.
    const travel = 1000 * 1.5 - doc.crop.rect.width;
    const free = resize(Array.from({ length: 100 }, () => travel / 100));
    expect(free.ratio).toBeCloseTo(3 / 2);
    const locked = dragResize(doc, free.anchor, 'e', 0, 0, {
      locked: true,
      snap: false,
      startRatio,
    });
    expect(locked.ratio).toBeCloseTo(3 / 2);
    expect(locked.crop.rect.width).toBeCloseTo(1500);
  });
});

describe('mode defaults', () => {
  it('snaps to the mode rect and keeps rotation', () => {
    const doc = withCrop(makeDoc(makeSource(400, 800), MUDAE_RATIO, 'fit', 90), {
      mode: 'fit',
      rect: { x: 10, y: 20, width: 100, height: 155.56 },
      rotation: 90,
    });
    const padded = applyScaleMode(doc, 'pad');
    expect(padded.crop.mode).toBe('pad');
    expect(padded.crop.rotation).toBe(90);
    expectRect(padded.crop.rect, baseRectFor(doc, { ...doc.crop, mode: 'pad' }));
  });

  it('resets zoom, position and rotation to the mode default', () => {
    const doc = makeDoc(makeSource(400, 800), MUDAE_RATIO, 'pad', 180);
    const reset = resetCrop(doc);
    expect(reset).toEqual({
      mode: 'pad',
      rect: baseRectFor(doc, { ...doc.crop, rotation: 0 }),
      rotation: 0,
    });
  });

  it('starts from the default Frame', () => {
    expect(makeDoc(null).frame).toEqual(DEFAULT_FRAME);
    expect(defaultCrop().rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('ratio changes', () => {
  it('keeps the long side and grows the short side, centred', () => {
    const doc = makeDoc(makeSource(2000, 1000));
    expectRect(frameRect(doc), {
      x: (2000 - 1000 * MUDAE_RATIO) / 2,
      y: 0,
      width: 1000 * MUDAE_RATIO,
      height: 1000,
    });

    const wide = applyRatio(doc, 16 / 9);
    expect(wide.frame.ratio).toBe(16 / 9);
    expectRect(wide.crop.rect, {
      x: (2000 - 1000 * (16 / 9)) / 2,
      y: 0,
      width: 1000 * (16 / 9),
      height: 1000,
    });
  });

  it('keeps the height when a 9:14 rect becomes 16:9', () => {
    const doc = makeDoc(makeSource(2000, 2000));
    const portrait = withCrop(doc, {
      mode: 'fit',
      rect: { x: 887.5, y: 825, width: 225, height: 350 },
      rotation: 0,
    });
    const wide = applyRatio(portrait, 16 / 9);
    expect(wide.crop.rect.height).toBeCloseTo(350);
    expect(wide.crop.rect.width).toBeCloseTo(350 * (16 / 9));
  });

  it('always leaves the rect on the exact stored ratio', () => {
    const doc = makeDoc(makeSource(2000, 2000));
    const wide = applyRatio(doc, 21 / 9);
    expect(wide.frame.ratio).toBe(21 / 9);
    expect(wide.crop.rect.width / wide.crop.rect.height).toBeCloseTo(21 / 9);
  });
});

describe('Frame resize', () => {
  const ratio = 500 / 280;
  const makeResizableDoc = () =>
    withCrop(makeDoc(makeSource(2000, 2000), ratio), {
      mode: 'fit',
      rect: { x: 750, y: 860, width: 500, height: 280 },
      rotation: 0,
    });

  it('snaps a free edge drag to a preset and keeps the dragged width', () => {
    const doc = makeResizableDoc();
    const width = 280 * (21 / 9);
    const result = resizeCrop(doc, doc.crop, 'e', width - 500, 0, { locked: false, snap: true });

    expect(result.ratio).toBeCloseTo(21 / 9);
    expect(result.crop.rect.width).toBeCloseTo(width);
    expect(result.crop.rect.height).toBeCloseTo(280);
    expect(result.crop.rect.x).toBeCloseTo(750);
    expect(result.crop.rect.x + result.crop.rect.width / 2).toBeCloseTo(750 + width / 2);
  });

  it('snaps a free corner drag keeping the dragged width and the corner anchor', () => {
    const doc = makeResizableDoc();
    const width = 280 * (21 / 9);
    const result = resizeCrop(doc, doc.crop, 'se', width - 500, 0, { locked: false, snap: true });

    expect(result.ratio).toBeCloseTo(21 / 9);
    expect(result.crop.rect.width).toBeCloseTo(width);
    expect(result.crop.rect.x).toBeCloseTo(750);
    expect(result.crop.rect.y).toBeCloseTo(860);
    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(21 / 9);
  });

  it('does not snap a free drag back to the proportion it started from', () => {
    const startRatio = 16 / 9;
    const height = 500 / startRatio;
    const doc = withCrop(makeDoc(makeSource(1000, 1000), startRatio), {
      mode: 'fit',
      rect: { x: 200, y: 300, width: 500, height },
      rotation: 0,
    });
    const result = resizeCrop(doc, doc.crop, 'e', 2, 0, {
      locked: false,
      snap: true,
      startRatio,
    });

    expect(result.ratio).toBeCloseTo(502 / height, 4);
    expect(result.ratio).not.toBeCloseTo(startRatio, 4);
  });

  it('holds a snapped preset for the rest of the drag', () => {
    const doc = makeDoc(makeSource(600, 800));
    const startRatio = doc.frame.ratio;
    const first = resizeCrop(doc, doc.crop, 'e', 20, 0, {
      locked: false,
      snap: true,
      startRatio,
    });
    expect(first.ratio).toBeCloseTo(2 / 3);

    // The next event starts from the snapped rect; the start proportion is
    // still Mudae, so 2:3 remains a target and the snap holds.
    const next = { ...doc, frame: { ratio: first.ratio }, crop: first.crop };
    const second = resizeCrop(next, first.crop, 'e', 2, 0, {
      locked: false,
      snap: true,
      startRatio,
    });
    expect(second.ratio).toBeCloseTo(2 / 3);
  });

  it('does not snap a locked drag and keeps the current Frame ratio', () => {
    const doc = makeResizableDoc();
    const result = resizeCrop(doc, doc.crop, 'e', 20, 0, { locked: true, snap: true });

    expect(result.ratio).toBeCloseTo(ratio);
    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(ratio);
  });

  it('leaves a free ratio alone when snapping is off', () => {
    const doc = makeResizableDoc();
    const result = resizeCrop(doc, doc.crop, 'e', 20, 0, { locked: false, snap: false });

    expect(result.ratio).toBeCloseTo(520 / 280);
    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(520 / 280);
  });

  it('keeps the ratio when a free drag runs into the size limit', () => {
    const doc = makeResizableDoc();
    const result = resizeCrop(doc, doc.crop, 'e', 10_000, 0, { locked: false, snap: false });

    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(result.ratio);
    expect(result.ratio).toBeGreaterThan(16 / 9);
    expect(result.crop.rect.width).toBeLessThanOrEqual(2000);
  });
});

describe('document crop commands', () => {
  it('applies a locked drag to the Frame and the Crop together', () => {
    const doc = makeDoc(makeSource(2000, 2000));
    const before = frameRect(doc);
    const result = resizeFrame(doc, 'e', -100, 0, { locked: true, snap: false });

    expect(result.frame.ratio).toBeCloseTo(doc.frame.ratio);
    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(result.frame.ratio);
    expect(result.crop.rect.width).toBeCloseTo(before.width - 100);
    expect(result.crop.rect.x).toBeCloseTo(before.x);
  });

  it('stores a free drag ratio and re-derives a locked Export size', () => {
    const doc = withResize(makeDoc(makeSource(2000, 2000)), { width: 400, height: 622 });
    const before = frameRect(doc);
    const result = resizeFrame(doc, 'e', -100, 0, { locked: false, snap: false });
    const expected = (before.width - 100) / before.height;

    expect(result.frame.ratio).toBeCloseTo(expected);
    expect(result.crop.rect.width / result.crop.rect.height).toBeCloseTo(expected);
    expect(result.resize).toEqual({ width: 400, height: Math.round(400 / expected) });
  });

  it('leaves the document alone when there is no Source', () => {
    const doc = makeDoc(null);
    expect(resizeFrame(doc, 'e', 20, 0, { locked: true, snap: false })).toBe(doc);
  });

  it('zoomTo sets the readout and keeps the Frame proportion', () => {
    const doc = makeDoc(makeSource(400, 800));
    const before = frameRect(doc);
    const zoomed = zoomTo(doc, 2);

    expect(zoomOf(zoomed)).toBeCloseTo(2);
    expect(zoomed.crop.rect.width).toBeCloseTo(before.width / 2);
    expect(zoomed.crop.rect.width / zoomed.crop.rect.height).toBeCloseTo(zoomed.frame.ratio);
    expect(zoomed.crop.rect.x + zoomed.crop.rect.width / 2).toBeCloseTo(
      before.x + before.width / 2,
    );
  });

  it('zoomTo ignores a non-positive or non-finite zoom', () => {
    const doc = makeDoc(makeSource(400, 800));
    expect(zoomTo(doc, 0)).toBe(doc);
    expect(zoomTo(doc, Number.NaN)).toBe(doc);
  });
});

describe('proportion change', () => {
  it('keeps a chosen Carta when the Mudae orientation flips', () => {
    const doc = withResize(makeDoc(makeSource(900, 1400)), { width: 225, height: 350 });
    const flipped = applyRatio(doc, 14 / 9);

    expect(flipped.frame.ratio).toBeCloseTo(14 / 9);
    expect(flipped.resize).toEqual({ width: 350, height: 225 });
  });

  it('keeps the Carta through the flip even with the lock switched off', () => {
    const doc = withResizeLocked(
      withResize(makeDoc(makeSource(900, 1400)), { width: 225, height: 350 }),
      false,
    );
    const flipped = applyRatio(doc, 14 / 9);

    expect(flipped.resize).toEqual({ width: 350, height: 225 });
    expect(flipped.resizeLocked).toBe(false);
  });

  it('keeps the current resize width for a non-Carta proportion', () => {
    const doc = withResize(makeDoc(makeSource(900, 1400)), { width: 400, height: 622 });
    const flipped = applyRatio(doc, 16 / 9);

    expect(flipped.resize?.width).toBe(400);
    expect(flipped.resize?.height).toBe(Math.round(400 / (16 / 9)));
  });

  it('stores the exact preset when the requested ratio is merely close', () => {
    const doc = makeDoc(makeSource(900, 1400));
    const applied = applyRatio(doc, MUDAE_RATIO * 1.0006);

    expect(applied.frame.ratio).toBe(MUDAE_RATIO);
    expect(applied.crop.rect.width / applied.crop.rect.height).toBeCloseTo(MUDAE_RATIO);
  });
});

describe('off-centre rotation', () => {
  it('moves the rect clockwise inside the swapped bounds', () => {
    const doc = makeDoc(makeSource(1000, 1000), MUDAE_RATIO);
    const crop = {
      ...doc.crop,
      rect: { x: 100, y: 100, width: 200, height: 200 / MUDAE_RATIO },
    };
    const rotated = rotate90(doc, crop);

    expect(rotated.rotation).toBe(90);
    expect(rotated.rect.width).toBeCloseTo(200);
    expect(rotated.rect.x + rotated.rect.width / 2).toBeCloseTo(
      1000 - (100 + 200 / MUDAE_RATIO / 2),
    );
    expect(rotated.rect.y + rotated.rect.height / 2).toBeCloseTo(200);
  });
});

describe('readouts', () => {
  it('nativeSize rounds the rect and never goes below 1', () => {
    const doc = makeDoc(makeSource(400, 800));
    expect(nativeSize(doc)).toEqual({ width: 400, height: 622 });
    expect(nativeSize(makeDoc(null))).toEqual({ width: 1, height: 1 });
  });

  it('offsetPct reports the centre offset as a fraction of the rect', () => {
    const doc = makeDoc(makeSource(800, 400));
    expect(offsetPct(doc).x).toBeCloseTo(0);
    expect(offsetPct(doc).y).toBeCloseTo(0);

    const right = panBy(doc, doc.crop, 10_000, 0).rect;
    expect(offsetPct({ ...doc, crop: { ...doc.crop, rect: right } }).x).toBeCloseTo(
      (right.x + right.width / 2 - 400) / right.width,
    );
  });
});

describe('Pad default from the Border', () => {
  it('copies the Border color the first time Pad is enabled', () => {
    const doc = withBorder(makeDoc(makeSource(400, 800)), { color: '#123456', width: 2 });

    const padded = applyScaleMode(doc, 'pad');

    expect(padded.crop.mode).toBe('pad');
    expect(padded.padColor).toBe('#123456');
    expect(padded.padColorExplicit).toBe(true);
  });

  it('keeps a Pad color the user chose before enabling Pad', () => {
    const doc = withPadColor(makeDoc(makeSource(400, 800)), '#FF0000');

    const padded = applyScaleMode(doc, 'pad');

    expect(padded.padColor).toBe('#FF0000');
  });

  it('does not copy the Border again after Pad was first enabled', () => {
    const first = applyScaleMode(
      withBorder(makeDoc(makeSource(400, 800)), { color: '#112233' }),
      'pad',
    );
    const fitted = applyScaleMode(first, 'fit');
    const again = applyScaleMode(withBorder(fitted, { color: '#445566' }), 'pad');

    expect(again.padColor).toBe('#112233');
  });
});
