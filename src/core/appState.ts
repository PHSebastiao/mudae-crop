/**
 * The app-level state shared by several entry points: the single-flight
 * activity lock, the notice bar and the URL download phase. It is a pure
 * reducer so every invariant is testable without React, the DOM or the
 * desktop shell.
 */

/** The one operation that can own the app at a time. */
export type ActivityLabel = 'import' | 'export' | 'upload' | 'download';

export type Activity =
  { readonly kind: 'idle' } | { readonly kind: 'running'; readonly label: ActivityLabel };

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

export interface AppShellState {
  readonly activity: Activity;
  readonly notice: Notice;
  readonly download: DownloadPhase;
}

export const IDLE_ACTIVITY: Activity = { kind: 'idle' };
export const NO_NOTICE: Notice = { kind: 'none' };
export const IDLE_DOWNLOAD: DownloadPhase = { kind: 'idle' };

export const INITIAL_APP_SHELL: AppShellState = {
  activity: IDLE_ACTIVITY,
  notice: NO_NOTICE,
  download: IDLE_DOWNLOAD,
};

export type AppShellAction =
  | { readonly type: 'begin'; readonly label: ActivityLabel }
  | { readonly type: 'end'; readonly label: ActivityLabel }
  | { readonly type: 'inform'; readonly message: string }
  | { readonly type: 'fail'; readonly message: string; readonly action: NoticeAction | null }
  | { readonly type: 'clear-notice' }
  | { readonly type: 'dismiss-error' }
  | { readonly type: 'download-start' }
  | { readonly type: 'download-progress'; readonly amount: DownloadAmount }
  | { readonly type: 'download-finish' }
  | { readonly type: 'download-end' };

/**
 * The single source of the shell transitions. `begin` refuses while an
 * operation runs, `end` only releases the operation that started it, a notice
 * holds one kind at a time, and progress only exists while downloading.
 */
export function reduceAppShell(state: AppShellState, action: AppShellAction): AppShellState {
  switch (action.type) {
    case 'begin':
      return state.activity.kind === 'running'
        ? state
        : { ...state, activity: { kind: 'running', label: action.label } };
    case 'end': {
      if (state.activity.kind !== 'running' || state.activity.label !== action.label) return state;
      return { ...state, activity: IDLE_ACTIVITY };
    }
    case 'inform':
      return { ...state, notice: { kind: 'info', message: action.message } };
    case 'fail':
      return {
        ...state,
        notice: { kind: 'error', message: action.message, action: action.action },
      };
    case 'clear-notice':
      return state.notice.kind === 'none' ? state : { ...state, notice: NO_NOTICE };
    case 'dismiss-error':
      return state.notice.kind === 'error' ? { ...state, notice: NO_NOTICE } : state;
    case 'download-start':
      return {
        ...state,
        download: { kind: 'downloading', received: 0, total: null },
      };
    case 'download-progress':
      if (state.download.kind !== 'downloading') return state;
      return {
        ...state,
        download: {
          kind: 'downloading',
          received: action.amount.received,
          total: action.amount.total,
        },
      };
    case 'download-finish':
      if (state.download.kind !== 'downloading') return state;
      return { ...state, download: { kind: 'finishing' } };
    case 'download-end':
      return { ...state, download: IDLE_DOWNLOAD };
  }
}
