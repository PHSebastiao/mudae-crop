import { describe, expect, it } from 'vitest';
import {
  beginActivity,
  BUSY_REFUSAL,
  canCancelDownload,
  clearNotice,
  dismissError,
  endActivity,
  endDownload,
  errorNotice,
  finishDownload,
  IDLE_ACTIVITY,
  IDLE_DOWNLOAD,
  infoNotice,
  NO_NOTICE,
  reportDownload,
  startDownload,
  type Activity,
  type NoticeAction,
} from '../src/core/appState';

describe('activity', () => {
  it('starts only when idle and names the operation that owns the app', () => {
    const started = beginActivity(IDLE_ACTIVITY, 'import');

    expect(started).toEqual({
      kind: 'started',
      activity: { kind: 'running', label: 'import' },
    });
    if (started.kind !== 'started') throw new Error('expected the activity to start');
    expect(endActivity(started.activity, 'import')).toEqual(IDLE_ACTIVITY);
    expect(beginActivity(endActivity(started.activity, 'import'), 'export').kind).toBe('started');
  });

  it('refuses a second activity with the busy reason and the import message', () => {
    const running: Activity = { kind: 'running', label: 'export' };

    expect(beginActivity(running, 'import')).toEqual({
      kind: 'refused',
      reason: 'busy',
      message: BUSY_REFUSAL,
    });
    expect(BUSY_REFUSAL).toBe('Termine a operação em andamento antes de importar outra Source.');
  });

  it('does not let one operation release another one’s run', () => {
    const running: Activity = { kind: 'running', label: 'upload' };

    expect(endActivity(running, 'export')).toBe(running);
    expect(endActivity(running, 'upload')).toEqual(IDLE_ACTIVITY);
  });
});

describe('notice', () => {
  const action: NoticeAction = { label: 'Abrir Configurações', run: () => undefined };

  it('holds one kind at a time: info replaces error and drops its action', () => {
    const failure = errorNotice('falhou', action);
    const success = infoNotice('deu certo');

    expect(failure).toEqual({ kind: 'error', message: 'falhou', action });
    expect(success).toEqual({ kind: 'info', message: 'deu certo' });
    expect('action' in success).toBe(false);
  });

  it('keeps the action only on an error that was given one', () => {
    expect(errorNotice('falhou')).toEqual({ kind: 'error', message: 'falhou', action: null });
    expect(errorNotice('falhou', action)).toEqual({
      kind: 'error',
      message: 'falhou',
      action,
    });
  });

  it('clears back to none from every kind', () => {
    expect(clearNotice()).toBe(NO_NOTICE);
    expect(clearNotice()).toEqual({ kind: 'none' });
  });

  it('dismisses an error but leaves an info untouched, as Settings does', () => {
    expect(dismissError(errorNotice('falhou', action))).toEqual(NO_NOTICE);
    expect(dismissError(infoNotice('deu certo'))).toEqual(infoNotice('deu certo'));
    expect(dismissError(NO_NOTICE)).toBe(NO_NOTICE);
  });
});

describe('download phase', () => {
  it('starts at zero bytes with an unknown total', () => {
    expect(startDownload()).toEqual({ kind: 'downloading', received: 0, total: null });
  });

  it('reports progress only while downloading', () => {
    const downloading = startDownload();

    expect(reportDownload(downloading, { received: 512, total: 1024 })).toEqual({
      kind: 'downloading',
      received: 512,
      total: 1024,
    });
    expect(reportDownload(IDLE_DOWNLOAD, { received: 512, total: 1024 })).toBe(IDLE_DOWNLOAD);
    const finishing = finishDownload(downloading);
    expect(reportDownload(finishing, { received: 1024, total: 1024 })).toBe(finishing);
  });

  it('can be cancelled only while the transfer is downloading', () => {
    const downloading = startDownload();

    expect(canCancelDownload(downloading)).toBe(true);
    expect(canCancelDownload(finishDownload(downloading))).toBe(false);
    expect(canCancelDownload(IDLE_DOWNLOAD)).toBe(false);
  });

  it('enters a non-cancellable finishing phase and then returns to idle', () => {
    const finishing = finishDownload(startDownload());

    expect(finishing).toEqual({ kind: 'finishing' });
    expect(canCancelDownload(finishing)).toBe(false);
    expect(finishDownload(finishing)).toBe(finishing);
    expect(endDownload()).toBe(IDLE_DOWNLOAD);
  });

  it('does not finish a phase that never started', () => {
    expect(finishDownload(IDLE_DOWNLOAD)).toBe(IDLE_DOWNLOAD);
  });
});
