import { useCallback, useEffect, useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { UpdatePhase } from '../core/update';

interface UpdateDialogProps {
  readonly phase: UpdatePhase;
  /** The version on offer. */
  readonly version: string | null;
  /** The version this build reports. */
  readonly current: string | null;
  readonly detail: string | null;
  readonly progressLabel: string;
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

  const title = phase === 'failed' ? 'Atualização interrompida' : 'Nova versão disponível';
  const versionLine = version
    ? current
      ? `A versão ${version} está pronta para instalar. Você está na ${current}.`
      : `A versão ${version} está pronta para instalar.`
    : 'Há uma nova versão pronta para instalar.';

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
            <p className="update-body">
              Não foi possível atualizar automaticamente. Baixe a nova versão no GitHub.
            </p>
            {detail && <p className="settings-hint">{detail}</p>}
            <div className="settings-actions">
              <button type="button" className="settings-primary" onClick={onOpenReleases}>
                Abrir a página da versão
              </button>
              <button type="button" onClick={onCloseFailure}>
                Fechar
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
                Veja as notas no GitHub
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
                  {phase === 'installing' ? 'Instalando…' : progressLabel}
                </span>
              </div>
            )}

            {phase === 'available' && (
              <>
                <p className="settings-hint">
                  O app fecha para instalar e reabre já na nova versão; o documento aberto é
                  perdido.
                </p>
                <div className="settings-actions">
                  <button type="button" className="settings-primary" onClick={onInstall}>
                    Instalar agora
                  </button>
                  <button type="button" onClick={onLater}>
                    Agora não
                  </button>
                  <button type="button" className="danger-ghost" onClick={onSkip}>
                    Pular esta versão
                  </button>
                </div>
              </>
            )}

            {phase === 'downloading' && canCancel && (
              <div className="settings-actions">
                <button type="button" onClick={onCancel}>
                  Cancelar
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
