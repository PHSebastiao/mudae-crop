/**
 * The app-level state shared by several entry points: the single-flight
 * activity lock, the notice bar and the URL download phase. It is pure so the
 * invariants can be tested without React, the DOM or the desktop shell.
 */

/** The one operation that can own the app at a time. */
export type ActivityLabel = 'import' | 'export' | 'upload' | 'download';

export type Activity =
  { readonly kind: 'idle' } | { readonly kind: 'running'; readonly label: ActivityLabel };

export const IDLE_ACTIVITY: Activity = { kind: 'idle' };

/** The shared pt-BR explanation for refusing a second operation. */
export const BUSY_REFUSAL = 'Termine a operação em andamento antes de importar outra Source.';

export type ActivityStart =
  | { readonly kind: 'started'; readonly activity: Activity }
  | { readonly kind: 'refused'; readonly reason: 'busy'; readonly message: string };

/** Start an activity unless another one already owns the app. */
export function beginActivity(current: Activity, label: ActivityLabel): ActivityStart {
  if (current.kind === 'running') {
    return { kind: 'refused', reason: 'busy', message: BUSY_REFUSAL };
  }
  return { kind: 'started', activity: { kind: 'running', label } };
}

/** Release the app, but only for the operation that started it. */
export function endActivity(current: Activity, label: ActivityLabel): Activity {
  return current.kind === 'running' && current.label === label ? IDLE_ACTIVITY : current;
}

export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
}

/**
 * The notice bar holds exactly one message at a time. An error may offer one
 * recovery action; an info notice never does.
 */
export type Notice =
  | { readonly kind: 'none' }
  | { readonly kind: 'info'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string; readonly action: NoticeAction | null };

export const NO_NOTICE: Notice = { kind: 'none' };

export function infoNotice(message: string): Notice {
  return { kind: 'info', message };
}

export function errorNotice(message: string, action: NoticeAction | null = null): Notice {
  return { kind: 'error', message, action };
}

/** Clear whatever the bar is showing. */
export function clearNotice(): Notice {
  return NO_NOTICE;
}

/**
 * Drop an error but keep an info notice. Opening Settings uses this: it
 * dismisses a failure while leaving an informational status untouched.
 */
export function dismissError(current: Notice): Notice {
  return current.kind === 'error' ? NO_NOTICE : current;
}

/** The bytes reported by the download transport. */
export interface DownloadAmount {
  readonly received: number;
  readonly total: number | null;
}

/**
 * The URL import has two visible steps. Progress only exists while the link is
 * being transferred; `finishing` covers local decoding, which is not
 * cancellable and therefore shows no download bar.
 */
export type DownloadPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'downloading'; readonly received: number; readonly total: number | null }
  | { readonly kind: 'finishing' };

export const IDLE_DOWNLOAD: DownloadPhase = { kind: 'idle' };

export function startDownload(): DownloadPhase {
  return { kind: 'downloading', received: 0, total: null };
}

/** Ignore progress that lands after the transfer has already finished. */
export function reportDownload(current: DownloadPhase, amount: DownloadAmount): DownloadPhase {
  if (current.kind !== 'downloading') return current;
  return { kind: 'downloading', received: amount.received, total: amount.total };
}

/** The link is down; decoding is local and no longer cancellable. */
export function finishDownload(current: DownloadPhase): DownloadPhase {
  return current.kind === 'downloading' ? { kind: 'finishing' } : current;
}

export function endDownload(): DownloadPhase {
  return IDLE_DOWNLOAD;
}

/** Cancelling is only possible while the transfer itself is running. */
export function canCancelDownload(current: DownloadPhase): boolean {
  return current.kind === 'downloading';
}
