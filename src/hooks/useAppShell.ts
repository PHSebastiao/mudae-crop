import { useCallback, useReducer } from 'react';
import {
  INITIAL_APP_SHELL,
  reduceAppShell,
  type ActivityLabel,
  type DownloadAmount,
  type DownloadPhase,
  type Notice,
  type NoticeAction,
} from '../core/appState';

/** The shared pt-BR explanation for refusing a second operation. */
const BUSY_REFUSAL = 'Termine a operação em andamento antes de importar outra Source.';

export type ActivityStart =
  { readonly ok: true } | { readonly ok: false; readonly message: string };

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
  readonly inform: (message: string) => void;
  readonly fail: (message: string, action?: NoticeAction | null) => void;
  readonly clearNotice: () => void;
  readonly dismissError: () => void;
  readonly startDownload: () => void;
  readonly reportDownload: (amount: DownloadAmount) => void;
  readonly finishDownload: () => void;
  readonly endDownload: () => void;
}

export function useAppShell(): AppShell {
  const [state, dispatch] = useReducer(reduceAppShell, INITIAL_APP_SHELL);

  // The guard reads the rendered activity: every caller is a user event or an
  // async continuation of one, so the value is current for this handler.
  const begin = useCallback(
    (label: ActivityLabel): ActivityStart => {
      if (state.activity.kind === 'running') return { ok: false, message: BUSY_REFUSAL };
      dispatch({ type: 'begin', label });
      return { ok: true };
    },
    [state.activity],
  );

  const end = useCallback((label: ActivityLabel) => dispatch({ type: 'end', label }), []);
  const inform = useCallback((message: string) => dispatch({ type: 'inform', message }), []);
  const fail = useCallback(
    (message: string, action: NoticeAction | null = null) =>
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
