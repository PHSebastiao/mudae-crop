import { useCallback, useReducer, useRef } from 'react';
import {
  IDLE_ACTIVITY,
  INITIAL_APP_SHELL,
  reduceAppShell,
  type ActivityLabel,
  type DownloadAmount,
  type DownloadPhase,
  type Notice,
  type NoticeAction,
} from '../core/appState';
import { text, type TextRef } from '../core/i18n/text';

export type ActivityStart =
  { readonly ok: true } | { readonly ok: false; readonly message: TextRef };

/**
 * The shell of `App`: which operation owns it, what the notice bar shows and
 * where the URL download is. It is one reducer so the component never has to
 * mirror the same value in a ref.
 */
export interface AppShell {
  readonly busy: boolean;
  /** The operation that owns the app, or null when idle. */
  readonly activity: ActivityLabel | null;
  readonly notice: Notice;
  readonly download: DownloadPhase;
  readonly begin: (label: ActivityLabel) => ActivityStart;
  readonly end: (label: ActivityLabel) => void;
  readonly inform: (message: TextRef) => void;
  readonly fail: (message: TextRef, action?: NoticeAction | null) => void;
  readonly clearNotice: () => void;
  readonly dismissError: () => void;
  readonly startDownload: () => void;
  readonly reportDownload: (amount: DownloadAmount) => void;
  readonly finishDownload: () => void;
  readonly endDownload: () => void;
}

export function useAppShell(): AppShell {
  const [state, dispatch] = useReducer(reduceAppShell, INITIAL_APP_SHELL);
  // The lock is claimed in the ref before React re-renders, so two commands in
  // the same frame (a fast double Ctrl+Enter) cannot both see an idle app.
  const activityRef = useRef(state.activity);
  activityRef.current = state.activity;

  const begin = useCallback((label: ActivityLabel): ActivityStart => {
    if (activityRef.current.kind === 'running') return { ok: false, message: text('notice.busy') };
    activityRef.current = { kind: 'running', label };
    dispatch({ type: 'begin', label });
    return { ok: true };
  }, []);

  const end = useCallback((label: ActivityLabel) => {
    const current = activityRef.current;
    if (current.kind === 'running' && current.label === label) {
      activityRef.current = IDLE_ACTIVITY;
    }
    dispatch({ type: 'end', label });
  }, []);
  const inform = useCallback((message: TextRef) => dispatch({ type: 'inform', message }), []);
  const fail = useCallback(
    (message: TextRef, action: NoticeAction | null = null) =>
      dispatch({ type: 'fail', message, action }),
    [],
  );
  const clearNotice = useCallback(() => dispatch({ type: 'clear-notice' }), []);
  const dismissError = useCallback(() => dispatch({ type: 'dismiss-error' }), []);
  const startDownload = useCallback(() => dispatch({ type: 'download-start' }), []);
  const reportDownload = useCallback(
    (amount: DownloadAmount) => dispatch({ type: 'download-progress', amount }),
    [],
  );
  const finishDownload = useCallback(() => dispatch({ type: 'download-finish' }), []);
  const endDownload = useCallback(() => dispatch({ type: 'download-end' }), []);

  return {
    busy: state.activity.kind === 'running',
    activity: state.activity.kind === 'running' ? state.activity.label : null,
    notice: state.notice,
    download: state.download,
    begin,
    end,
    inform,
    fail,
    clearNotice,
    dismissError,
    startDownload,
    reportDownload,
    finishDownload,
    endDownload,
  };
}
