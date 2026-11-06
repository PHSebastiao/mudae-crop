import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAD_COLOR,
  FIT_CROP,
  MUDAE_FRAME,
  MUDAE_LANDSCAPE_FRAME,
  SQUARE_FRAME,
  emptyDocument,
  frameFor,
  orientationOf,
  outputSize,
  presetOf,
  swappedFrame,
  withCrop,
  withExportScale,
  withFrame,
  withPadColor,
  withSource,
} from '../src/core/document';
import { makeDoc, makeSource } from './helpers';

describe('document', () => {
  it('starts empty with the Mudae frame, a Fit crop and a 1× Export', () => {
    const doc = emptyDocument();
    expect(doc.source).toBeNull();
    expect(doc.frame).toEqual(MUDAE_FRAME);
    expect(doc.crop).toEqual(FIT_CROP);
    expect(doc.padColor).toBe(DEFAULT_PAD_COLOR);
    expect(doc.exportScale).toBe(1);
  });

  it('keeps every setting outside the Crop when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const settings = withExportScale(
      withPadColor(
        withFrame(
          withCrop(makeDoc(first), { mode: 'pad', zoom: 3, offsetX: 40, offsetY: -20, rotation: 90 }),
          MUDAE_LANDSCAPE_FRAME,
        ),
        '#123456',
      ),
      2,
    );

    const replaced = withSource(settings, makeSource(800, 400));

    expect(replaced.source).not.toBe(first);
    expect(replaced.frame).toEqual(MUDAE_LANDSCAPE_FRAME);
    expect(replaced.padColor).toBe('#123456');
    expect(replaced.exportScale).toBe(2);
    expect(replaced.crop).toEqual(FIT_CROP);
  });

  it('leaves settings it does not own untouched, ready for Border', () => {
    const first = makeSource(400, 800);
    const settings = {
      ...makeDoc(first),
      border: { width: 2, color: '#ffcc00' },
    };

    const replaced = withSource(settings, makeSource(800, 400)) as typeof settings;

    expect(replaced.border).toEqual({ width: 2, color: '#ffcc00' });
    expect(replaced.crop).toEqual(FIT_CROP);
  });
});

describe('Frame presets', () => {
  it('gives each Preset and orientation its exact Frame', () => {
    expect(frameFor('mudae', 'portrait')).toEqual({ id: 'mudae', label: 'Mudae 225×350', width: 225, height: 350 });
    expect(frameFor('mudae', 'landscape')).toEqual({
      id: 'mudae-landscape',
      label: 'Mudae landscape 350×225',
      width: 350,
      height: 225,
    });
    expect(frameFor('square', 'portrait')).toEqual({
      id: 'square',
      label: 'Square 350×350',
      width: 350,
      height: 350,
    });
  });

  it('keeps Square square when the orientation is swapped', () => {
    expect(frameFor('square', 'landscape')).toBe(SQUARE_FRAME);
    expect(swappedFrame(SQUARE_FRAME)).toBe(SQUARE_FRAME);
  });

  it('reads the Preset and orientation back from the Frame', () => {
    expect(presetOf(MUDAE_FRAME)).toBe('mudae');
    expect(presetOf(SQUARE_FRAME)).toBe('square');
    expect(orientationOf(MUDAE_FRAME)).toBe('portrait');
    expect(orientationOf(MUDAE_LANDSCAPE_FRAME)).toBe('landscape');
    expect(swappedFrame(MUDAE_FRAME)).toBe(MUDAE_LANDSCAPE_FRAME);
    expect(swappedFrame(MUDAE_LANDSCAPE_FRAME)).toBe(MUDAE_FRAME);
  });
});

describe('export size', () => {
  it('doubles both axes for a 2× Export', () => {
    const doc = withExportScale(makeDoc(makeSource(450, 700)), 2);
    expect(outputSize(doc)).toEqual({ width: 450, height: 700 });

    const square = withExportScale(
      { ...makeDoc(makeSource(450, 700)), frame: SQUARE_FRAME },
      2,
    );
    expect(outputSize(square)).toEqual({ width: 700, height: 700 });
  });

  it('uses an explicit scale when one is given', () => {
    const doc = makeDoc(makeSource(450, 700));
    expect(outputSize(doc, 1)).toEqual({ width: 225, height: 350 });
  });
});
