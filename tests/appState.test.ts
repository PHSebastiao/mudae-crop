import { describe, expect, it } from 'vitest';
import {
  IDLE_DOWNLOAD,
  INITIAL_APP_SHELL,
  NO_NOTICE,
  reduceAppShell,
  type AppShellAction,
  type AppShellState,
  type NoticeAction,
} from '../src/core/appState';

function run(...actions: readonly AppShellAction[]): AppShellState {
  return actions.reduce(reduceAppShell, INITIAL_APP_SHELL);
}

const action: NoticeAction = { label: 'Abrir Configurações', run: () => undefined };

describe('activity', () => {
  it('starts only when idle and names the operation that owns the app', () => {
    const running = run({ type: 'begin', label: 'import' });

    expect(running.activity).toEqual({ kind: 'running', label: 'import' });
    expect(reduceAppShell(running, { type: 'end', label: 'import' }).activity).toEqual({
      kind: 'idle',
    });
  });

  it('ignores a second begin while an operation owns the app', () => {
    const running = run({ type: 'begin', label: 'export' }, { type: 'begin', label: 'import' });

    expect(running.activity).toEqual({ kind: 'running', label: 'export' });
  });

  it('does not let one operation release another one’s run', () => {
    const running = run({ type: 'begin', label: 'upload' });

    expect(reduceAppShell(running, { type: 'end', label: 'export' })).toBe(running);
    expect(reduceAppShell(running, { type: 'end', label: 'upload' }).activity).toEqual({
      kind: 'idle',
    });
  });
});

describe('notice', () => {
  it('holds one kind at a time: info replaces an error and drops its action', () => {
    const failed = run({ type: 'fail', message: 'falhou', action });
    expect(failed.notice).toEqual({ kind: 'error', message: 'falhou', action });

    const informed = reduceAppShell(failed, { type: 'inform', message: 'deu certo' });
    expect(informed.notice).toEqual({ kind: 'info', message: 'deu certo' });
  });

  it('keeps the action only on an error that was given one', () => {
    expect(run({ type: 'fail', message: 'falhou', action: null }).notice).toEqual({
      kind: 'error',
      message: 'falhou',
      action: null,
    });
  });

  it('clears back to none and leaves a cleared bar untouched', () => {
    const cleared = run(
      { type: 'fail', message: 'falhou', action: null },
      { type: 'clear-notice' },
    );

    expect(cleared.notice).toBe(NO_NOTICE);
    expect(reduceAppShell(cleared, { type: 'clear-notice' })).toBe(cleared);
  });

  it('dismisses an error but leaves an info untouched, as Settings does', () => {
    const failed = run({ type: 'fail', message: 'falhou', action });
    expect(reduceAppShell(failed, { type: 'dismiss-error' }).notice).toBe(NO_NOTICE);

    const informed = run({ type: 'inform', message: 'deu certo' });
    expect(reduceAppShell(informed, { type: 'dismiss-error' })).toBe(informed);
  });
});

describe('download phase', () => {
  it('starts at zero bytes with an unknown total', () => {
    expect(run({ type: 'download-start' }).download).toEqual({
      kind: 'downloading',
      received: 0,
      total: null,
    });
  });

  it('reports progress only while downloading', () => {
    const downloading = run(
      { type: 'download-start' },
      { type: 'download-progress', amount: { received: 512, total: 1024 } },
    );
    expect(downloading.download).toEqual({ kind: 'downloading', received: 512, total: 1024 });

    const finishing = run({ type: 'download-start' }, { type: 'download-finish' });
    expect(
      reduceAppShell(finishing, {
        type: 'download-progress',
        amount: { received: 1024, total: 1024 },
      }),
    ).toBe(finishing);
  });

  it('enters a finishing phase that ends back at idle', () => {
    const finishing = run({ type: 'download-start' }, { type: 'download-finish' });

    expect(finishing.download).toEqual({ kind: 'finishing' });
    expect(reduceAppShell(finishing, { type: 'download-finish' })).toBe(finishing);
    expect(reduceAppShell(finishing, { type: 'download-end' }).download).toBe(IDLE_DOWNLOAD);
  });

  it('does not finish a phase that never started', () => {
    const idle = run();
    expect(reduceAppShell(idle, { type: 'download-finish' })).toBe(idle);
  });
});
