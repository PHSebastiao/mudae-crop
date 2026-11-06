import { describe, expect, it } from 'vitest';
import { FIT_CROP, MUDAE_FRAME, emptyDocument, withCrop, withSource } from '../src/core/document';
import { makeDoc, makeSource } from './helpers';

describe('document', () => {
  it('starts empty with the Mudae frame and a Fit crop', () => {
    const doc = emptyDocument();
    expect(doc.source).toBeNull();
    expect(doc.frame).toEqual(MUDAE_FRAME);
    expect(doc.crop).toEqual(FIT_CROP);
  });

  it('keeps the Frame and resets the Crop when a Source is replaced', () => {
    const first = makeSource(400, 800);
    const withFirst = withCrop(makeDoc(first), { zoom: 3, offsetX: 40, offsetY: -20 });
    const second = makeSource(800, 400);

    const replaced = withSource(withFirst, second);

    expect(replaced.source).toBe(second);
    expect(replaced.frame).toEqual(MUDAE_FRAME);
    expect(replaced.crop).toEqual(FIT_CROP);
  });
});
