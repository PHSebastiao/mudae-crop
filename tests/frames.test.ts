import { describe, expect, it } from 'vitest';
import {
  MIN_FRAME_DELAY_MS,
  animationFrameCount,
  effectiveDelayMs,
  effectiveSource,
  effectiveTrim,
  frameDelayMs,
  frameImage,
  isAnimated,
  withFrameDelay,
  withFrameEffectiveDelay,
  withFrameRemoved,
  withSource,
  withSpeed,
  withTrim,
  withTrimEnabled,
} from '../src/core/document';
import { trimDurationMs } from '../src/core/animation';
import { exportKindFor, renderGif } from '../src/core/export';
import { decodeGif } from '../src/core/gif';
import { makeAnimatedSource, makeDoc, makeSource, testExportAdapter } from './helpers';
import { pixelAt } from './gifFixtures';

function centerColors(gif: ReturnType<typeof decodeGif>): number[][] {
  return gif.frames.map((frame) =>
    pixelAt(frame.pixels, gif.width, Math.floor(gif.width / 2), Math.floor(gif.height / 2)).slice(
      0,
      3,
    ),
  );
}

const source = () => makeAnimatedSource(20, 20, ['#FF0000', '#00FF00', '#0000FF'], [100, 120, 80]);

describe('frame edits', () => {
  it('starts from the Source animation and resets when the Source is replaced', () => {
    const doc = makeDoc(source());
    const edited = withFrameDelay(withFrameRemoved(doc, 0), 0, 500);

    expect(animationFrameCount(effectiveSource(edited))).toBe(2);
    expect(edited.animation).not.toBe(doc.animation);

    const replacement = makeAnimatedSource(20, 20, ['#FFFFFF', '#000000'], [60, 60]);
    const replaced = withSource(edited, replacement);

    expect(replaced.animation).toBe(replacement.animation);
    expect(animationFrameCount(effectiveSource(replaced))).toBe(2);
    expect(frameDelayMs(effectiveSource(replaced), 0)).toBe(60);
  });

  it('deleting a frame shrinks the assembled animation and its duration', () => {
    const src = source();
    const doc = makeDoc(src);
    const without = withFrameRemoved(doc, 1);
    const view = effectiveSource(without);

    expect(animationFrameCount(view)).toBe(2);
    expect(frameDelayMs(view, 0)).toBe(100);
    expect(frameDelayMs(view, 1)).toBe(80);
    expect(effectiveTrim(without)).toEqual({ start: 0, end: 1 });
    expect(trimDurationMs(view, effectiveTrim(without), 1)).toBe(180);
    // The frame at the old index 1 is gone; index 1 now shows the old frame 2.
    expect(frameImage(view, 1)).toBe(src.animation?.frames[2].image);
  });

  it('keeps at least one frame', () => {
    const one = withFrameRemoved(makeDoc(source()), 1);
    const two = withFrameRemoved(one, 0);
    const last = withFrameRemoved(two, 0);

    expect(animationFrameCount(effectiveSource(last))).toBe(1);
    expect(isAnimated(effectiveSource(last))).toBe(false);
    expect(withFrameRemoved(last, 0)).toBe(last);
  });

  it('moves the Trim bounds with the deleted frame', () => {
    const doc = withTrimEnabled(withTrim(makeDoc(source()), { start: 1, end: 2 }), true);

    // Deleting before the range shifts both bounds down.
    expect(withFrameRemoved(doc, 0).trim).toEqual({ start: 0, end: 1 });
    // Deleting the first frame of the range keeps the surviving frame selected.
    expect(withFrameRemoved(doc, 1).trim).toEqual({ start: 1, end: 1 });
    // Deleting the last frame of the range shrinks it.
    expect(withFrameRemoved(doc, 2).trim).toEqual({ start: 1, end: 1 });
  });

  it('collapses a one-frame Trim onto a neighbour instead of widening it', () => {
    const doc = withTrimEnabled(withTrim(makeDoc(source()), { start: 1, end: 1 }), true);
    const without = withFrameRemoved(doc, 1);

    expect(without.trim).toEqual({ start: 0, end: 0 });
    expect(trimDurationMs(effectiveSource(without), effectiveTrim(without), 1)).toBe(100);
  });

  it('retimes a frame with the 20 ms floor', () => {
    const doc = makeDoc(source());

    expect(frameDelayMs(effectiveSource(withFrameDelay(doc, 1, 5)), 1)).toBe(MIN_FRAME_DELAY_MS);
    expect(frameDelayMs(effectiveSource(withFrameDelay(doc, 1, 240)), 1)).toBe(240);

    const retimed = withFrameDelay(doc, 1, 5);
    expect(trimDurationMs(effectiveSource(retimed), effectiveTrim(retimed), 1)).toBe(200);
  });

  it('stores the retimed base while Preview and Export use the 10 ms grid', async () => {
    const doc = withFrameDelay(makeDoc(source()), 1, 37);
    const gif = decodeGif(await renderGif(doc, testExportAdapter));

    expect(frameDelayMs(effectiveSource(doc), 1)).toBe(37);
    expect(effectiveDelayMs(effectiveSource(doc), 1)).toBe(40);
    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([100, 40, 80]);
  });

  it('retimes in the duration the frame plays at the current Speed', async () => {
    const doc = withSpeed(makeDoc(source()), 2);
    const retimed = withFrameEffectiveDelay(doc, 1, 100);
    const gif = decodeGif(await renderGif(retimed, testExportAdapter));

    expect(frameDelayMs(effectiveSource(retimed), 1)).toBe(200);
    expect(effectiveDelayMs(effectiveSource(retimed), 1, 2)).toBe(100);
    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([50, 100, 40]);

    const slow = withSpeed(makeDoc(source()), 0.25);
    const slowed = withFrameEffectiveDelay(slow, 1, 100);
    expect(frameDelayMs(effectiveSource(slowed), 1)).toBe(25);
    expect(effectiveDelayMs(effectiveSource(slowed), 1, 0.25)).toBe(100);
  });

  it('keeps the 20 ms floor after speed scaling and rounding', () => {
    expect(effectiveDelayMs(effectiveSource(withFrameDelay(makeDoc(source()), 1, 21)), 1)).toBe(20);
    expect(effectiveDelayMs(effectiveSource(withFrameDelay(makeDoc(source()), 1, 24)), 1)).toBe(20);
  });
});

describe('frame edits in the Export', () => {
  it('exports only the frames that remain', async () => {
    const doc = withFrameRemoved(makeDoc(source()), 1);
    const gif = decodeGif(await renderGif(doc, testExportAdapter));

    expect(gif.frames).toHaveLength(2);
    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([100, 80]);
    expect(centerColors(gif)).toEqual([
      [255, 0, 0],
      [0, 0, 255],
    ]);
  });

  it('exports the retimed delay, including the floor', async () => {
    const doc = withFrameDelay(makeDoc(source()), 1, 5);
    const gif = decodeGif(await renderGif(doc, testExportAdapter));

    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([100, 20, 80]);
    expect(centerColors(gif)[1]).toEqual([0, 255, 0]);
  });

  it('exports the Trim of the edited animation', async () => {
    const doc = withTrimEnabled(withFrameRemoved(makeDoc(source()), 0), true);
    const trimmed = withTrim(doc, { start: 0, end: 1 });
    const gif = decodeGif(await renderGif(trimmed, testExportAdapter));

    expect(gif.frames).toHaveLength(2);
    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([120, 80]);
    expect(centerColors(gif)).toEqual([
      [0, 255, 0],
      [0, 0, 255],
    ]);
  });

  it('turns a one-frame animation into a still PNG Export', async () => {
    let doc = makeDoc(source());
    doc = withFrameRemoved(doc, 0);
    doc = withFrameRemoved(doc, 0);

    expect(isAnimated(effectiveSource(doc))).toBe(false);
    expect(effectiveTrim(doc)).toBeNull();
    expect(exportKindFor(effectiveSource(doc)).format).toBe('png');
    await expect(renderGif(doc, testExportAdapter)).rejects.toMatchObject({
      message: 'A Source não é animada.',
    });
  });

  it('leaves a still Source untouched', () => {
    const still = makeSource(20, 20);
    const doc = makeDoc(still);

    expect(effectiveSource(doc)).toBe(still);
    expect(withFrameRemoved(doc, 0)).toBe(doc);
    expect(withFrameDelay(doc, 0, 500)).toBe(doc);
  });
});
