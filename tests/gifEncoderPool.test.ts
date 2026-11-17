import { describe, expect, it } from 'vitest';
import { encodeGifFrame, type GifEncodeFrame } from '../src/core/gif';
import { GifWorkerPool } from '../src/platform/gifEncoder';
import type { GifEncodeReply, GifEncodeRequest } from '../src/workers/gifEncoder.worker';

/** A one-pixel frame whose red channel tells it apart from the others. */
function frame(red: number): GifEncodeFrame {
  return { pixels: new Uint8ClampedArray([red, 0, 0, 255]), delayMs: 100 };
}

/** A worker that answers on demand, so the test owns the completion order. */
class FakeWorker {
  onmessage: ((event: MessageEvent<GifEncodeReply>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  readonly requests: GifEncodeRequest[] = [];
  terminated = false;

  postMessage(request: GifEncodeRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer one request with the same data the real worker would send. */
  reply(id: number): void {
    const request = this.requests.find((entry) => entry.id === id);
    if (!request) throw new Error(`sem pedido ${id}`);
    const encoded = encodeGifFrame(request.pixels);
    const palette = new Uint8Array(encoded.palette.length * 3);
    encoded.palette.forEach((color, index) => {
      palette[index * 3] = color.r;
      palette[index * 3 + 1] = color.g;
      palette[index * 3 + 2] = color.b;
    });
    this.onmessage?.({
      data: {
        id,
        palette,
        transparentIndex: encoded.transparentIndex,
        minCodeSize: encoded.minCodeSize,
        data: encoded.data,
        pixels: encoded.pixels,
      },
    } as MessageEvent<GifEncodeReply>);
  }
}

function poolOf(size: number): { pool: GifWorkerPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const pool = new GifWorkerPool(size, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { pool, workers };
}

describe('GifWorkerPool', () => {
  it('queues a frame while the only worker is busy', async () => {
    const { pool, workers } = poolOf(1);

    const first = pool.encode(frame(1));
    const second = pool.encode(frame(2));

    expect(workers[0].requests).toHaveLength(1);
    workers[0].reply(1);
    await expect(first).resolves.toMatchObject({ pixels: 1 });
    expect(workers[0].requests).toHaveLength(2);

    workers[0].reply(2);
    await expect(second).resolves.toMatchObject({ pixels: 1 });
  });

  it('resolves each frame from its own worker, whatever the order', async () => {
    const { pool, workers } = poolOf(2);

    const first = pool.encode(frame(1));
    const second = pool.encode(frame(2));

    expect(workers).toHaveLength(2);
    const [left, right] = [workers[0].requests[0], workers[1].requests[0]];
    // The second worker finishes first: the promises must not be swapped.
    workers[1].reply(right.id);
    workers[0].reply(left.id);

    const [one, two] = await Promise.all([first, second]);
    expect(one.palette[0].r).toBe(1);
    expect(two.palette[0].r).toBe(2);
  });

  it('rejects the frame of a worker that errors', async () => {
    const { pool, workers } = poolOf(1);

    const attempt = pool.encode(frame(1));
    workers[0].onerror?.(new Error('boom'));

    await expect(attempt).rejects.toThrow('gifEncoder.failed');
  });

  it('fails what is in flight when closed and starts over afterwards', async () => {
    const { pool, workers } = poolOf(1);

    const attempt = pool.encode(frame(1));
    pool.close();

    await expect(attempt).rejects.toThrow('gifEncoder.terminated');
    expect(workers[0].terminated).toBe(true);

    const again = pool.encode(frame(2));
    expect(workers).toHaveLength(2);
    const request = workers[1].requests[0];
    workers[1].reply(request.id);
    await expect(again).resolves.toMatchObject({ pixels: 1 });
  });

  it('encodes on the main thread when no worker can start', async () => {
    const pool = new GifWorkerPool(2, () => {
      throw new Error('sem workers');
    });

    const encoded = await pool.encode(frame(1));

    expect(encoded.palette[0]).toEqual({ r: 1, g: 0, b: 0 });
    expect(encoded.pixels).toBe(1);
  });
});
