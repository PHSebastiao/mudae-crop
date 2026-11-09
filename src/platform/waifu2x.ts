import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  waifu2xArgs,
  type Waifu2xExit,
  type Waifu2xHandle,
  type Waifu2xSpawn,
  type Waifu2xStatus,
} from '../core/waifu2x';

/** A flat 32×32 PNG used once to prove the sidecar and a Vulkan device work. */
const PROBE_PNG = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 32, 0, 0, 0, 32, 8, 6, 0,
  0, 0, 115, 122, 122, 244, 0, 0, 0, 4, 115, 66, 73, 84, 8, 8, 8, 8, 124, 8, 100, 136, 0, 0, 0, 1,
  115, 82, 71, 66, 0, 174, 206, 28, 233, 0, 0, 0, 48, 73, 68, 65, 84, 88, 133, 237, 206, 49, 1, 0,
  48, 12, 195, 176, 172, 200, 195, 124, 133, 209, 71, 38, 96, 189, 182, 63, 135, 205, 229, 28, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 73, 22, 79, 122, 2, 191, 244, 156, 132, 251, 0, 0, 0, 0,
  73, 69, 78, 68, 174, 66, 96, 130,
]);

export interface Waifu2xAvailability {
  readonly status: Waifu2xStatus;
  /** A pt-BR explanation shown under the disabled controls. */
  readonly detail: string | null;
}

interface Waifu2xProbeReply {
  readonly status: string;
  readonly detail: string | null;
}

interface Waifu2xLogPayload {
  readonly id: string;
  readonly line: string;
}

const STATUSES: readonly Waifu2xStatus[] = ['ready', 'unsupported', 'missing', 'failed'];

function messageOf(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error && reason.message) return reason.message;
  return 'falha desconhecida';
}

async function probeOnce(): Promise<Waifu2xAvailability> {
  if (!isTauri()) {
    return {
      status: 'missing',
      detail: 'O waifu2x só funciona no app desktop; no navegador ele fica desligado.',
    };
  }
  try {
    const reply = await invoke<Waifu2xProbeReply>('waifu2x_probe', {
      args: waifu2xArgs({ denoise: 0, scale: 1 }),
      input: Array.from(PROBE_PNG),
    });
    const status = STATUSES.includes(reply.status as Waifu2xStatus)
      ? (reply.status as Waifu2xStatus)
      : 'failed';
    return { status, detail: reply.detail };
  } catch (reason) {
    return { status: 'failed', detail: messageOf(reason) };
  }
}

let probePromise: Promise<Waifu2xAvailability> | null = null;

/**
 * Detect the bundled sidecar and a Vulkan device once at launch. The promise is
 * shared, so React's development StrictMode remount cannot start two probes;
 * the Rust side also caches the result for the life of the process.
 */
export function probeWaifu2x(): Promise<Waifu2xAvailability> {
  probePromise ??= probeOnce();
  return probePromise;
}

let jobSequence = 0;

function failureExit(reason: unknown): Waifu2xExit {
  const failure = reason as { code?: unknown; detail?: unknown } | null;
  if (failure && typeof failure.code === 'string') {
    if (failure.code === 'cancelled') return { code: 130, stderr: 'cancelado' };
    return {
      code: 1,
      stderr: typeof failure.detail === 'string' ? failure.detail : failure.code,
    };
  }
  return { code: 1, stderr: messageOf(reason) };
}

/**
 * The native sidecar transport. Arguments carry `{input}`, `{output}` and
 * `{models}` placeholders; Rust writes the rendered PNG to a temp file, resolves
 * the bundled paths, streams stderr lines back as events and returns the
 * processed PNG through the raw IPC response.
 */
export const tauriWaifu2xSpawn: Waifu2xSpawn = (args, input, onLine): Waifu2xHandle => {
  const id = `waifu-${Date.now()}-${++jobSequence}`;

  const result = (async (): Promise<Waifu2xExit> => {
    // Register before starting the process, so the GPU banner and the first
    // progress line cannot arrive before anyone listens.
    const stop = await listen<Waifu2xLogPayload>('waifu2x-log', (event) => {
      if (event.payload.id === id) onLine(event.payload.line);
    }).catch(() => null as UnlistenFn | null);
    try {
      const buffer = await invoke<ArrayBuffer>('waifu2x_process', {
        args,
        input: Array.from(input),
        job_id: id,
      });
      return { code: 0, output: new Uint8Array(buffer) };
    } catch (reason) {
      return failureExit(reason);
    } finally {
      stop?.();
    }
  })();

  return {
    result,
    cancel: () => {
      void invoke('cancel_waifu2x', { job_id: id }).catch(() => undefined);
    },
  };
};
