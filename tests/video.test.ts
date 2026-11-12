import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  animationFrameCount,
  frameDelayMs,
  frameImage,
  isAnimated,
  withTrim,
  withTrimEnabled,
} from '../src/core/document';
import { renderGif, renderPng, type EncodableCanvas, type ExportAdapter } from '../src/core/export';
import { decodeGif } from '../src/core/gif';
import { renderFrame } from '../src/core/render';
import { videoPreviewRate } from '../src/core/animation';
import { contextOf, makeDoc, makeVideoFixture, pngPixels } from './helpers';

const adapter: ExportAdapter = {
  createCanvas(width: number, height: number): EncodableCanvas {
    return createCanvas(width, height) as unknown as EncodableCanvas;
  },
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    return new Uint8Array((canvas as unknown as Canvas).toBuffer('image/png'));
  },
};

describe('video Sources', () => {
  it('count as animations with their frame rate as the delay', () => {
    const { source } = makeVideoFixture(8, 8, ['#FF0000', '#00FF00', '#0000FF'], 12);

    expect(isAnimated(source)).toBe(true);
    expect(animationFrameCount(source)).toBe(3);
    expect(frameDelayMs(source, 1)).toBeCloseTo(1000 / 12);
    expect(frameImage(source, 0)).toBe(source.video?.image);
  });

  it('slows the native preview to the GIF rate when the floor caps a high-fps clip', () => {
    const { source } = makeVideoFixture(8, 8, ['#FF0000', '#00FF00'], 60);
    expect(videoPreviewRate(source, 1)).toBeCloseTo(0.8333, 3);

    const thirty = makeVideoFixture(8, 8, ['#FF0000', '#00FF00'], 30).source;
    // 30 fps quantises to 30 ms in the GIF, so the native preview runs faster.
    expect(videoPreviewRate(thirty, 1)).toBeCloseTo(1.1111, 3);
  });

  it('exports only the trimmed frames, with speed-scaled delays and a loop', async () => {
    const { source, seeks } = makeVideoFixture(225, 350, ['#FF0000', '#00FF00', '#0000FF'], 10);
    const doc = withTrimEnabled(withTrim(makeDoc(source), { start: 1, end: 2 }), true);

    const bytes = await renderGif({ ...doc, speed: 2 }, adapter);
    const decoded = decodeGif(bytes);

    expect(decoded.width).toBe(225);
    expect(decoded.height).toBe(350);
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([50, 50]);
    expect(decoded.loopCount).toBe(0);
    expect(seeks).toEqual([1, 2]);
  });

  it('folds identical adjacent video frames into one image', async () => {
    const { source } = makeVideoFixture(60, 60, ['#FF0000', '#FF0000', '#00FF00'], 10);
    const doc = makeDoc(source);

    const decoded = decodeGif(await renderGif(doc, adapter));

    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames.map((frame) => frame.delayMs)).toEqual([200, 100]);
  });

  it('exports the selected frame as PNG', async () => {
    const { source } = makeVideoFixture(225, 350, ['#FF0000', '#00FF00'], 10);
    const doc = makeDoc(source);

    const bytes = await renderPng(doc, adapter, {
      frameIndex: 1,
      prepare: () => source.video!.seekToFrame(1),
    });

    const reference = createCanvas(225, 350);
    renderFrame(contextOf(reference), doc, { outputWidth: 225, outputHeight: 350, frameIndex: 1 });
    const expected = reference.getContext('2d').getImageData(0, 0, 225, 350).data;

    expect(Buffer.from(await pngPixels(bytes)).equals(Buffer.from(expected))).toBe(true);
  });
});
