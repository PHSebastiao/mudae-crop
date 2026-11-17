import { useCallback, useEffect, useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useI18n } from '../hooks/useI18n';
import type { UpdatePhase } from '../core/update';
import type { TextRef } from '../core/i18n/text';

interface UpdateDialogProps {
  readonly phase: UpdatePhase;
  /** The version on offer. */
  readonly version: string | null;
  /** The version this build reports. */
  readonly current: string | null;
  readonly detail: TextRef | null;
  readonly progressLabel: TextRef | null;
  readonly percent: number | null;
  /** The portable swap downloads natively and cannot be cancelled mid-flight. */
  readonly canCancel: boolean;
  readonly onInstall: () => void;
  readonly onLater: () => void;
  readonly onSkip: () => void;
  readonly onCancel: () => void;
  readonly onCloseFailure: () => void;
  readonly onOpenReleases: () => void;
}

/**
 * The one moment the app asks for a restart. The update installs and reopens
 * the window by itself, so the copy warns that the open document is lost
 * instead of offering a restart choice the installed build cannot honour.
 */
export function UpdateDialog({
  phase,
  version,
  current,
  detail,
  progressLabel,
  percent,
  canCancel,
  onInstall,
  onLater,
  onSkip,
  onCancel,
  onCloseFailure,
  onOpenReleases,
}: UpdateDialogProps) {
  const { t, tr } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);

  const dismiss = useCallback(() => {
    if (phase === 'downloading') {
      if (canCancel) onCancel();
    } else if (phase === 'failed') onCloseFailure();
    else if (phase !== 'installing') onLater();
  }, [canCancel, onCancel, onCloseFailure, onLater, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss]);

  const title = phase === 'failed' ? t('update.failedTitle') : t('update.title');
  const versionLine = version
    ? current
      ? t('update.readyAt', { version, current })
      : t('update.ready', { version })
    : t('update.available');

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={modalRef}
        className="settings-modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <header className="settings-head">
          <h2 id="update-title">{title}</h2>
        </header>

        {phase === 'failed' ? (
          <section>
            <p className="update-body">{t('update.failedBody')}</p>
            {detail && <p className="settings-hint">{tr(detail)}</p>}
            <div className="settings-actions">
              <button type="button" className="settings-primary" onClick={onOpenReleases}>
                {t('update.openReleases')}
              </button>
              <button type="button" onClick={onCloseFailure}>
                {t('common.close')}
              </button>
            </div>
          </section>
        ) : (
          <section>
            <p className="update-body">{versionLine}</p>
            <p className="settings-hint">
              <a
                className="inline-link"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenReleases();
                }}
              >
                {t('update.notes')}
              </a>
            </p>

            {(phase === 'downloading' || phase === 'installing') && (
              <div className="update-progress" role="status" aria-live="polite">
                <div
                  className={`update-bar${percent === null ? ' indeterminate' : ''}`}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                >
                  <span style={percent === null ? undefined : { width: `${percent}%` }} />
                </div>
                <span className="settings-hint">
                  {phase === 'installing'
                    ? t('update.installing')
                    : progressLabel
                      ? tr(progressLabel)
                      : null}
                </span>
              </div>
            )}

            {phase === 'available' && (
              <>
                <p className="settings-hint">{t('update.installNote')}</p>
                <div className="settings-actions">
                  <button type="button" className="settings-primary" onClick={onInstall}>
                    {t('update.installNow')}
                  </button>
                  <button type="button" onClick={onLater}>
                    {t('update.later')}
                  </button>
                  <button type="button" className="danger-ghost" onClick={onSkip}>
                    {t('update.skip')}
                  </button>
                </div>
              </>
            )}

            {phase === 'downloading' && canCancel && (
              <div className="settings-actions">
                <button type="button" onClick={onCancel}>
                  {t('common.cancel')}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
