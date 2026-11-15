/**
 * The two shapes a batch command needs to work on several Tiles at once: run
 * every item with a bounded window, and produce ahead while consuming in order.
 * Both keep the input order in the result, so the Board order stays the order of
 * the folder Export, the Post and the clipboard set.
 */

/** Throw the signal's reason, so a cancelled batch stays a cancelled batch. */
function aborted(signal: AbortSignal): never {
  const reason: unknown = signal.reason;
  throw reason instanceof Error ? reason : new Error('Cancelado.');
}

/**
 * Run `run` over `items` with at most `limit` in flight and return the results
 * in input order. Only the order work finishes decides which item starts next.
 *
 * A failure stops new items from starting; the ones already running finish, and
 * the first rejection is the one the caller sees.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (stopped) return;
      if (signal?.aborted) aborted(signal);
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await run(items[index], index);
      } catch (reason) {
        stopped = true;
        throw reason;
      }
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/**
 * Produce results with at most `limit` in flight and consume them one at a time
 * in input order. The producer runs ahead, the consumer never overlaps itself,
 * so a slow sidecar or a request overlaps the next item's render while writes
 * and Posts still happen in Board order.
 */
export async function pipelineInOrder<T, R>(
  items: readonly T[],
  limit: number,
  produce: (item: T, index: number) => Promise<R>,
  consume: (result: R, item: T, index: number) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) return;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const queue: Array<{ index: number; result: Promise<R> }> = [];
  let next = 0;

  const fill = (): void => {
    while (queue.length < width && next < items.length) {
      if (signal?.aborted) aborted(signal);
      const index = next;
      next += 1;
      const result = produce(items[index], index);
      // A later rejection is still handled when its turn comes; marking it now
      // keeps an earlier failure from surfacing as an unhandled rejection.
      result.catch(() => undefined);
      queue.push({ index, result });
    }
  };

  fill();
  while (queue.length > 0) {
    const head = queue.shift() as { index: number; result: Promise<R> };
    const result = await head.result;
    await consume(result, items[head.index], head.index);
    fill();
  }
}

/**
 * A one-permit lock: calls queue up and run one at a time. Used for work that
 * cannot overlap with itself, such as two waifu2x sidecars on one GPU.
 */
export function createMutex(): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    // The next run starts whether the previous one resolved or rejected; a
    // failed run must never wedge the queue.
    const next = tail.then(run, run);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
