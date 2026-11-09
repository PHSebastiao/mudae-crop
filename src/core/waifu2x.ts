/**
 * The waifu2x sidecar seam. The app renders the Crop to a PNG, hands it to the
 * native sidecar, and draws the returned PNG back. This module owns the
 * arguments, the progress text and the cancellation contract; the platform
 * layer owns the process itself, so the wrapper can be tested against a fake
 * sidecar without a GPU.
 */

export type Waifu2xDenoise = 0 | 1 | 2 | 3;
/** The scale choices exposed in the UI; 2× and 4× define the Export size. */
export type Waifu2xScale = 1 | 2 | 4;

export interface Waifu2xSettings {
  readonly enabled: boolean;
  readonly denoise: Waifu2xDenoise;
  readonly scale: Waifu2xScale;
}

/** The result of the launch-time sidecar/Vulkan check. */
export type Waifu2xStatus = 'checking' | 'ready' | 'unsupported' | 'missing' | 'failed';

/** Untrusted values a settings patch may carry before clamping. */
export interface Waifu2xPatch {
  readonly enabled?: boolean;
  readonly denoise?: number;
  readonly scale?: number;
}

/** Off at every level: a fresh document never starts with waifu2x. */
export const DEFAULT_WAIFU2X: Waifu2xSettings = Object.freeze({
  enabled: false,
  denoise: 1,
  scale: 1,
});

function readDenoise(value: unknown, fallback: Waifu2xDenoise): Waifu2xDenoise {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(3, Math.max(0, Math.round(value))) as Waifu2xDenoise;
}

function readScale(value: unknown, fallback: Waifu2xScale): Waifu2xScale {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value <= 1) return 1;
  if (value <= 2) return 2;
  return 4;
}

/** Merge a patch over `base`, keeping every field inside its allowed set. */
export function clampWaifu2x(
  patch: Waifu2xPatch,
  base: Waifu2xSettings = DEFAULT_WAIFU2X,
): Waifu2xSettings {
  return {
    enabled: patch.enabled ?? base.enabled,
    denoise: readDenoise(patch.denoise, base.denoise),
    scale: readScale(patch.scale, base.scale),
  };
}

/** The placeholders the native side replaces with real temp paths. */
export const WAIFU2X_INPUT = '{input}';
export const WAIFU2X_OUTPUT = '{output}';
export const WAIFU2X_MODELS = '{models}';

/**
 * The sidecar invocation. `-n` is denoise 0–3 (0 still processes), `-s` is the
 * upscale, `-m` is the bundled cunet model and `-f png` keeps the alpha we
 * rendered. Paths are placeholders so the wrapper is testable without files.
 */
export function waifu2xArgs(settings: Pick<Waifu2xSettings, 'denoise' | 'scale'>): string[] {
  return [
    '-i',
    WAIFU2X_INPUT,
    '-o',
    WAIFU2X_OUTPUT,
    '-m',
    WAIFU2X_MODELS,
    '-n',
    String(settings.denoise),
    '-s',
    String(settings.scale),
    '-f',
    'png',
  ];
}

/**
 * Read the sidecar's progress line. The upstream binary prints a percentage
 * (sometimes with leading spaces and a carriage return); anything else, such as
 * the GPU banner, is ignored.
 */
export function parseWaifu2xProgress(line: string): number | null {
  const match = /(\d+(?:[.,]\d+)?)\s*%/.exec(line);
  if (!match) return null;
  const percent = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(percent)) return null;
  return Math.min(1, Math.max(0, percent / 100));
}

export interface Waifu2xExit {
  readonly code: number;
  readonly output?: Uint8Array;
  readonly stderr?: string;
}

export interface Waifu2xHandle {
  /** Resolves when the process ends; never rejects for a non-zero exit. */
  readonly result: Promise<Waifu2xExit>;
  /** Ask the process to stop. The result still resolves, usually with 130. */
  cancel(): void;
}

/**
 * Start the sidecar with the resolved arguments and the rendered PNG. The
 * returned line callback receives stderr lines for progress parsing.
 */
export type Waifu2xSpawn = (
  args: readonly string[],
  input: Uint8Array,
  onLine: (line: string) => void,
) => Waifu2xHandle;

export interface Waifu2xRunOptions {
  readonly signal?: AbortSignal;
  /** Parsed progress from 0 to 1. */
  readonly onProgress?: (fraction: number) => void;
}

export class Waifu2xError extends Error {
  /** True when the user cancelled; the caller keeps the document as it was. */
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'Waifu2xError';
    this.cancelled = cancelled;
  }
}

/**
 * Run one image through the sidecar. An abort asks the process to stop and
 * always surfaces as a cancelled error, so a caller can never mistake a killed
 * run for a successful one.
 */
export async function runWaifu2x(
  input: Uint8Array,
  settings: Waifu2xSettings,
  spawn: Waifu2xSpawn,
  options: Waifu2xRunOptions = {},
): Promise<Uint8Array> {
  if (options.signal?.aborted) {
    throw new Waifu2xError('waifu2x cancelado.', true);
  }

  let lastProgress = -1;
  const handle = spawn(waifu2xArgs(settings), input, (line) => {
    const fraction = parseWaifu2xProgress(line);
    if (fraction === null || fraction === lastProgress) return;
    lastProgress = fraction;
    options.onProgress?.(fraction);
  });

  const abort = () => handle.cancel();
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const exit = await handle.result;
    if (options.signal?.aborted) {
      throw new Waifu2xError('waifu2x cancelado.', true);
    }
    if (exit.code !== 0) {
      const detail = exit.stderr?.trim() || `código ${exit.code}`;
      throw new Waifu2xError(`O waifu2x falhou: ${detail}`);
    }
    if (!exit.output || exit.output.length === 0) {
      throw new Waifu2xError('O waifu2x não produziu uma imagem.');
    }
    return exit.output;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}
