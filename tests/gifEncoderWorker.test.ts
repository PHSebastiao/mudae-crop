import { describe, expect, it, vi } from 'vitest';
import { encodeGifFrame } from '../src/core/gif';
import type { GifEncodeReply, GifEncodeRequest } from '../src/workers/gifEncoder.worker';

interface WorkerScope {
  onmessage: ((event: MessageEvent<GifEncodeRequest>) => void) | null;
  postMessage: (message: GifEncodeReply, transfer?: Transferable[]) => void;
}

const replies: GifEncodeReply[] = [];
const scope: WorkerScope = {
  onmessage: null,
  postMessage: (message) => {
    replies.push(message);
  },
};
// The worker assigns its handler on the global scope at import time; Node has
// no `self`, so the test provides the same shape the WebView does.
vi.stubGlobal('self', scope);

describe('GIF encoder worker', () => {
  it('replies with the palette and LZW data the main thread would build', async () => {
    await import('../src/workers/gifEncoder.worker');
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
    const expected = encodeGifFrame(pixels);

    scope.onmessage?.({ data: { id: 7, pixels } } as MessageEvent<GifEncodeRequest>);

    const reply = replies[0];
    expect(reply.id).toBe(7);
    expect(reply.transparentIndex).toBe(expected.transparentIndex);
    expect(reply.minCodeSize).toBe(expected.minCodeSize);
    expect(reply.pixels).toBe(expected.pixels);
    expect(Array.from(reply.palette)).toEqual(
      expected.palette.flatMap((color) => [color.r, color.g, color.b]),
    );
    expect(Array.from(reply.data)).toEqual(Array.from(expected.data));
  });
});
