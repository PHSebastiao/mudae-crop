import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import {
  animationFrameCount,
  frameDelayMs,
  frameImage,
  isAnimated,
  withTrim,
  withTrimEnabled,
  type Source,
  type VideoSource,
} from '../src/core/document';
import { renderGif, renderPng, type EncodableCanvas, type ExportAdapter } from '../src/core/export';
import { decodeGif } from '../src/core/gif';
import { renderFrame } from '../src/core/render';
import { contextOf, makeDoc } from './helpers';

const adapter: ExportAdapter = {
  createCanvas(width: number, height: number): EncodableCanvas {
    return createCanvas(width, height) as unknown as EncodableCanvas;
  },
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    return new Uint8Array((canvas as unknown as Canvas).toBuffer('image/png'));
  },
};

function makeVideoFixture(
  width: number,
  height: number,
  colors: readonly string[],
  fps = 10,
): { source: Source; seeks: number[] } {
  const frames = colors.map((color) => {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, width, height);
    return canvas as unknown as CanvasImageSource;
  });
  let index = 0;
  const seeks: number[] = [];
  const video: VideoSource = {
    frameCount: frames.length,
    fps,
    durationMs: (frames.length / fps) * 1000,
    get image() {
      return frames[index];
    },
    get currentTimeMs() {
      return (index / fps) * 1000;
    },
    async seekToFrame(next) {
      index = Math.min(frames.length - 1, Math.max(0, next));
      seeks.push(index);
    },
    async seekToMs(ms) {
      index = Math.min(frames.length - 1, Math.max(0, Math.round((ms / 1000) * fps)));
      seeks.push(index);
    },
    play() {},
    pause() {},
    dispose() {},
  };

  return {
    source: {
      name: 'fixture.mp4',
      path: null,
      width,
      height,
      format: 'mp4',
      bytes: 4096,
      image: frames[0],
      video,
    },
    seeks,
  };
}

describe('video Sources', () => {
  it('count as animations with their frame rate as the delay', () => {
    const { source } = makeVideoFixture(8, 8, ['#FF0000', '#00FF00', '#0000FF'], 12);

    expect(isAnimated(source)).toBe(true);
    expect(animationFrameCount(source)).toBe(3);
    expect(frameDelayMs(source, 1)).toBeCloseTo(1000 / 12);
    expect(frameImage(source, 0)).toBe(source.video?.image);
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

  it('exports the selected frame as PNG', async () => {
    const { source } = makeVideoFixture(225, 350, ['#FF0000', '#00FF00'], 10);
    const doc = makeDoc(source);

    const bytes = await renderPng(doc, adapter, {
      frameIndex: 1,
      prepare: () => source.video!.seekToFrame(1),
    });

    const reference = createCanvas(225, 350);
    renderFrame(contextOf(reference), doc, { scale: 1, frameIndex: 1 });
    const expected = new Uint8Array(reference.toBuffer('image/png'));

    expect(Buffer.from(bytes).equals(Buffer.from(expected))).toBe(true);
  });
});
