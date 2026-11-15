import type { Rgb } from '../core/color';
import type { GifFrameEncoder } from '../core/export';
import { encodeGifFrame, type EncodedGifFrame, type GifEncodeFrame } from '../core/gif';
import type { GifEncodeReply } from '../workers/gifEncoder.worker';

/** One frame waiting for a worker, or being encoded by one. */
interface Job {
  readonly frame: GifEncodeFrame;
  slot: number;
  readonly resolve: (frame: EncodedGifFrame) => void;
  readonly reject: (reason: unknown) => void;
}

function hardwareCores(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return typeof cores === 'number' && cores > 0 ? cores : 4;
}

/** How a slot gets its worker; a seam so a test can drive the pool without one. */
export type GifWorkerSpawn = (slot: number) => Worker;

function spawnWorker(slot: number): Worker {
  return new Worker(new URL('../workers/gifEncoder.worker.ts', import.meta.url), {
    type: 'module',
    name: `gif-encoder-${slot}`,
  });
}

/**
 * How many workers the pool starts: one per core, leaving one for the main
 * thread, and never more than four. Quantizing a frame is memory-hungry, and a
 * card Export gains nothing from more workers than that.
 */
export function gifEncoderPoolSize(cores = hardwareCores()): number {
  return Math.max(1, Math.min(4, Math.floor(cores) - 1));
}

/**
 * A small pool of module workers that quantize and LZW GIF frames. The main
 * thread keeps rendering and framing the file, so the expensive half of each
 * frame runs while the next one is painted.
 *
 * Frames wait in a queue when every worker is busy — the pool never blocks the
 * caller with a synchronous encode — and a machine that cannot start a worker
 * at all falls back to encoding on the main thread for the rest of the run.
 */
export class GifWorkerPool implements GifFrameEncoder {
  private readonly size: number;
  private readonly workers: Array<Worker | null>;
  private readonly idle: number[] = [];
  private readonly jobs = new Map<number, Job>();
  private readonly queue: number[] = [];
  private sequence = 0;
  private broken = false;
  private readonly spawn: GifWorkerSpawn;

  constructor(size = gifEncoderPoolSize(), spawn: GifWorkerSpawn = spawnWorker) {
    this.size = Math.max(1, Math.floor(size));
    this.workers = Array.from({ length: this.size }, () => null);
    this.spawn = spawn;
  }

  encode(frame: GifEncodeFrame): Promise<EncodedGifFrame> {
    if (this.broken) return Promise.resolve(encodeGifFrame(frame.pixels));
    return new Promise<EncodedGifFrame>((resolve, reject) => {
      const id = ++this.sequence;
      this.jobs.set(id, { frame, slot: -1, resolve, reject });
      this.queue.push(id);
      this.pump();
    });
  }

  /** Stop every worker and fail whatever is in flight; a later call starts over. */
  close(): void {
    for (const [index, worker] of this.workers.entries()) {
      worker?.terminate();
      this.workers[index] = null;
    }
    this.idle.length = 0;
    this.queue.length = 0;
    for (const job of this.jobs.values()) {
      job.reject(new Error('O codificador do GIF foi encerrado.'));
    }
    this.jobs.clear();
  }

  /** Start queued frames on every free worker, in arrival order. */
  private pump(): void {
    while (this.queue.length > 0 && !this.broken) {
      const id = this.queue[0];
      const job = this.jobs.get(id);
      if (!job) {
        this.queue.shift();
        continue;
      }
      const slot = this.take();
      if (slot === null) return;
      this.queue.shift();

      let worker: Worker;
      try {
        worker = this.workerAt(slot);
      } catch {
        // No worker can be started: finish this frame and the rest here rather
        // than failing an Export over an environment quirk.
        this.jobs.delete(id);
        this.release(slot);
        this.broken = true;
        this.encodeHere(job);
        this.flushQueueHere();
        return;
      }

      job.slot = slot;
      // The pool owns the copy: the caller keeps its pixels to compare the next
      // frame against, and the worker gets a buffer it can take over.
      const copy = new Uint8ClampedArray(job.frame.pixels);
      try {
        worker.postMessage({ id, pixels: copy }, [copy.buffer]);
      } catch (reason) {
        this.jobs.delete(id);
        this.release(slot);
        job.reject(reason);
      }
    }
  }

  private flushQueueHere(): void {
    for (const id of this.queue.splice(0)) {
      const job = this.jobs.get(id);
      if (!job) continue;
      this.jobs.delete(id);
      this.encodeHere(job);
    }
  }

  private encodeHere(job: Job): void {
    try {
      job.resolve(encodeGifFrame(job.frame.pixels));
    } catch (reason) {
      job.reject(reason);
    }
  }

  private take(): number | null {
    const free = this.idle.pop();
    if (free !== undefined) return free;
    const index = this.workers.indexOf(null);
    return index >= 0 ? index : null;
  }

  private release(slot: number): void {
    if (!this.idle.includes(slot)) this.idle.push(slot);
  }

  private workerAt(slot: number): Worker {
    const existing = this.workers[slot];
    if (existing) return existing;
    const worker = this.spawn(slot);
    worker.onmessage = (event: MessageEvent<GifEncodeReply>) => this.settle(slot, event.data);
    worker.onerror = () => this.fail(slot, 'O codificador do GIF falhou.');
    worker.onmessageerror = () =>
      this.fail(slot, 'O codificador do GIF devolveu uma mensagem inválida.');
    this.workers[slot] = worker;
    return worker;
  }

  private settle(slot: number, reply: GifEncodeReply): void {
    const job = this.jobs.get(reply.id);
    if (!job) return;
    this.jobs.delete(reply.id);
    this.release(slot);
    if (reply.error) {
      job.reject(new Error(reply.error));
    } else {
      job.resolve(decodedFrame(reply));
    }
    this.pump();
  }

  /** A broken worker is dropped; its frame fails rather than encoding twice. */
  private fail(slot: number, message: string): void {
    this.workers[slot]?.terminate();
    this.workers[slot] = null;
    const idleAt = this.idle.indexOf(slot);
    if (idleAt >= 0) this.idle.splice(idleAt, 1);
    for (const [id, job] of this.jobs) {
      if (job.slot !== slot) continue;
      this.jobs.delete(id);
      job.reject(new Error(message));
    }
    this.pump();
  }
}

/** Turn the worker's RGB triplets back into the palette the writer takes. */
function decodedFrame(reply: GifEncodeReply): EncodedGifFrame {
  const palette: Rgb[] = [];
  for (let offset = 0; offset + 2 < reply.palette.length; offset += 3) {
    palette.push({
      r: reply.palette[offset],
      g: reply.palette[offset + 1],
      b: reply.palette[offset + 2],
    });
  }
  return {
    palette,
    transparentIndex: reply.transparentIndex,
    minCodeSize: reply.minCodeSize,
    data: reply.data,
    pixels: reply.pixels,
  };
}

/** The app's pool: workers start on the first GIF Export and live with the window. */
export const gifFrameEncoder = new GifWorkerPool();
