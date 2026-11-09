import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WAIFU2X,
  Waifu2xError,
  clampWaifu2x,
  parseWaifu2xProgress,
  runWaifu2x,
  waifu2xArgs,
  type Waifu2xHandle,
  type Waifu2xSpawn,
} from '../src/core/waifu2x';

/** A fake sidecar that records its arguments and replays scripted output. */
function fakeSidecar(
  script: {
    lines?: readonly string[];
    code?: number;
    stderr?: string;
    output?: Uint8Array;
    hang?: boolean;
  } = {},
): { spawn: Waifu2xSpawn; calls: { args: readonly string[]; input: Uint8Array }[] } {
  const calls: { args: readonly string[]; input: Uint8Array }[] = [];
  const spawn: Waifu2xSpawn = (args, input, onLine) => {
    calls.push({ args, input });
    let cancel: (() => void) | null = null;
    const result = new Promise<{
      code: number;
      output?: Uint8Array;
      stderr?: string;
    }>((resolve) => {
      for (const line of script.lines ?? []) onLine(line);
      if (script.hang) {
        cancel = () => resolve({ code: 130, stderr: 'cancelled' });
        return;
      }
      resolve({
        code: script.code ?? 0,
        output: script.output ?? new Uint8Array([1, 2, 3]),
        stderr: script.stderr,
      });
    });
    const handle: Waifu2xHandle = {
      result,
      cancel: () => cancel?.(),
    };
    return handle;
  };
  return { spawn, calls };
}

describe('waifu2x arguments', () => {
  it('passes the denoise level, the scale and PNG output to the sidecar', () => {
    expect(waifu2xArgs({ denoise: 3, scale: 4 })).toEqual([
      '-i',
      '{input}',
      '-o',
      '{output}',
      '-m',
      '{models}',
      '-n',
      '3',
      '-s',
      '4',
      '-f',
      'png',
    ]);
  });

  it('keeps denoise 0 at 1x as a real run, not a shortcut', () => {
    expect(waifu2xArgs({ denoise: 0, scale: 1 })).toContain('0');
    expect(waifu2xArgs({ denoise: 0, scale: 1 })).toContain('1');
  });
});

describe('waifu2x progress', () => {
  it('reads a percentage line in any spacing', () => {
    expect(parseWaifu2xProgress('  0.00%')).toBe(0);
    expect(parseWaifu2xProgress(' 12.5%')).toBeCloseTo(0.125);
    expect(parseWaifu2xProgress('100.00%')).toBe(1);
  });

  it('ignores lines that are not progress', () => {
    expect(parseWaifu2xProgress('[0 NVIDIA GeForce RTX 5060] queueC=2')).toBeNull();
    expect(parseWaifu2xProgress('')).toBeNull();
  });

  it('reports each distinct progress value once', async () => {
    const onProgress = vi.fn();
    const { spawn } = fakeSidecar({ lines: [' 0.00%', ' 0.00%', ' 50.00%', '100.00%', 'done'] });

    await runWaifu2x(new Uint8Array([9]), { ...DEFAULT_WAIFU2X, enabled: true }, spawn, {
      onProgress,
    });

    expect(onProgress.mock.calls.map(([fraction]) => fraction)).toEqual([0, 0.5, 1]);
  });
});

describe('waifu2x run', () => {
  it('returns the sidecar bytes on success', async () => {
    const { spawn, calls } = fakeSidecar({ output: new Uint8Array([4, 5, 6]) });

    const bytes = await runWaifu2x(
      new Uint8Array([1, 2, 3]),
      { ...DEFAULT_WAIFU2X, enabled: true, denoise: 2, scale: 2 },
      spawn,
    );

    expect(bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0].args).toContain('2');
  });

  it('fails with the sidecar stderr on a non-zero exit', async () => {
    const { spawn } = fakeSidecar({ code: 1, stderr: 'vkCreateInstance failed' });

    const attempt = runWaifu2x(new Uint8Array([1]), DEFAULT_WAIFU2X, spawn);

    await expect(attempt).rejects.toBeInstanceOf(Waifu2xError);
    await expect(attempt).rejects.toMatchObject({ cancelled: false });
    await expect(attempt).rejects.toThrow('vkCreateInstance failed');
  });

  it('fails when the sidecar produces no image', async () => {
    const { spawn } = fakeSidecar({ output: new Uint8Array(0) });

    await expect(runWaifu2x(new Uint8Array([1]), DEFAULT_WAIFU2X, spawn)).rejects.toMatchObject({
      cancelled: false,
    });
  });

  it('cancels the sidecar when the signal aborts', async () => {
    const controller = new AbortController();
    const { spawn } = fakeSidecar({ hang: true });

    const attempt = runWaifu2x(new Uint8Array([1]), DEFAULT_WAIFU2X, spawn, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(attempt).rejects.toMatchObject({ cancelled: true });
  });

  it('never starts a sidecar when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { spawn, calls } = fakeSidecar();

    await expect(
      runWaifu2x(new Uint8Array([1]), DEFAULT_WAIFU2X, spawn, { signal: controller.signal }),
    ).rejects.toMatchObject({ cancelled: true });
    expect(calls).toHaveLength(0);
  });
});

describe('waifu2x settings', () => {
  it('is off by default', () => {
    expect(DEFAULT_WAIFU2X.enabled).toBe(false);
    expect(DEFAULT_WAIFU2X.scale).toBe(1);
  });

  it('clamps denoise to 0-3 and scale to 1, 2 or 4', () => {
    expect(clampWaifu2x({ denoise: 9 }).denoise).toBe(3);
    expect(clampWaifu2x({ denoise: -2 }).denoise).toBe(0);
    expect(clampWaifu2x({ scale: 3 }).scale).toBe(4);
    expect(clampWaifu2x({ scale: 0 }).scale).toBe(1);
  });

  it('keeps the denoise and scale when only the toggle changes', () => {
    const base = { enabled: true, denoise: 3 as const, scale: 2 as const };
    expect(clampWaifu2x({ enabled: false }, base)).toEqual({
      enabled: false,
      denoise: 3,
      scale: 2,
    });
  });
});
