import { describe, expect, it } from 'vitest';
import { createMutex, mapWithConcurrency, pipelineInOrder } from '../src/core/concurrency';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let every already-started async worker run up to its next await. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('mapWithConcurrency', () => {
  it('runs at most the limit at once and keeps the input order', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const done: number[] = [];

    const attempt = mapWithConcurrency([0, 1, 2], 2, async (value) => {
      started.push(value);
      await gates[value].promise;
      done.push(value);
      return value * 10;
    });

    await tick();
    expect(started).toEqual([0, 1]);

    gates[0].resolve();
    await tick();
    // The free worker picks the next item even though item 1 is still running.
    expect(started).toEqual([0, 1, 2]);
    expect(done).toEqual([0]);

    gates[2].resolve();
    gates[1].resolve();
    // Completion order was 0, 2, 1; the result keeps the input order.
    expect(await attempt).toEqual([0, 10, 20]);
    expect(done).toEqual([0, 2, 1]);
  });

  it('stops starting new items after a failure', async () => {
    const gate = deferred();
    const started: number[] = [];

    const attempt = mapWithConcurrency([0, 1, 2], 2, async (value) => {
      started.push(value);
      if (value === 1) throw new Error('boom');
      await gate.promise;
      return value;
    });

    await expect(attempt).rejects.toThrow('boom');
    expect(started).toEqual([0, 1]);

    gate.resolve();
    await tick();
    // Item 2 never started, even after the other worker came back.
    expect(started).toEqual([0, 1]);
  });

  it('throws the abort reason before starting anything', async () => {
    const controller = new AbortController();
    controller.abort(new Error('parar'));

    await expect(
      mapWithConcurrency([0, 1], 2, async (value) => value, controller.signal),
    ).rejects.toThrow('parar');
  });

  it('returns an empty list without running anything', async () => {
    let calls = 0;
    expect(
      await mapWithConcurrency([], 2, async () => {
        calls += 1;
        return 1;
      }),
    ).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('pipelineInOrder', () => {
  it('produces ahead but consumes in input order', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const produced: number[] = [];
    const consumed: number[] = [];

    const attempt = pipelineInOrder(
      [0, 1, 2],
      2,
      async (value) => {
        produced.push(value);
        await gates[value].promise;
        return value * 10;
      },
      (result) => {
        consumed.push(result);
      },
    );

    await tick();
    expect(produced).toEqual([0, 1]);

    // Item 1 finishes first; the consumer still waits for item 0.
    gates[1].resolve();
    await tick();
    expect(consumed).toEqual([]);

    gates[0].resolve();
    await tick();
    // Item 1 was already done, so it follows immediately, still after item 0.
    expect(consumed).toEqual([0, 10]);
    expect(produced).toEqual([0, 1, 2]);

    gates[2].resolve();
    await attempt;
    expect(consumed).toEqual([0, 10, 20]);
  });

  it('stops producing when the consumer fails', async () => {
    const produced: number[] = [];

    const attempt = pipelineInOrder(
      [0, 1, 2],
      2,
      async (value) => {
        produced.push(value);
        return value;
      },
      (result) => {
        if (result === 0) throw new Error('consome');
      },
    );

    await expect(attempt).rejects.toThrow('consome');
    expect(produced).toEqual([0, 1]);
  });

  it('propagates a producer failure when its turn comes', async () => {
    const attempt = pipelineInOrder(
      [0, 1],
      2,
      async (value) => {
        if (value === 1) throw new Error('produz');
        return value;
      },
      () => undefined,
    );

    await expect(attempt).rejects.toThrow('produz');
  });
});

describe('createMutex', () => {
  it('runs one at a time in arrival order', async () => {
    const lock = createMutex();
    const gates = [deferred(), deferred()];
    const order: string[] = [];

    const first = lock(async () => {
      order.push('a:start');
      await gates[0].promise;
      order.push('a:end');
      return 1;
    });
    const second = lock(async () => {
      order.push('b:start');
      await gates[1].promise;
      order.push('b:end');
      return 2;
    });

    await tick();
    expect(order).toEqual(['a:start']);

    gates[0].resolve();
    await tick();
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);

    gates[1].resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
  });

  it('keeps the queue moving after a failure', async () => {
    const lock = createMutex();

    await expect(
      lock(async () => {
        throw new Error('falhou');
      }),
    ).rejects.toThrow('falhou');
    expect(await lock(async () => 7)).toBe(7);
  });
});
