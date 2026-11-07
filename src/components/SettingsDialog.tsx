import { useCallback, useEffect, useState } from 'react';
import type { ExportScale } from '../core/document';
import { PRIVACY_OPTIONS } from '../core/imagechest';
import type { Settings } from '../core/settings';
import { NumberField } from './NumberField';

export interface TokenTestResult {
  readonly ok: boolean;
  readonly message: string;
}

interface SettingsDialogProps {
  readonly settings: Settings;
  readonly desktop: boolean;
  readonly testing: boolean;
  readonly testResult: TokenTestResult | null;
  readonly onChange: (patch: Partial<Settings>) => void;
  readonly onClose: () => void;
  readonly onTestConnection: () => void;
  readonly onClearToken: () => void;
  readonly onChooseFolder: () => void;
  readonly onClearFolder: () => void;
}

export function SettingsDialog({
  settings,
  desktop,
  testing,
  testResult,
  onChange,
  onClose,
  onTestConnection,
  onClearToken,
  onChooseFolder,
  onClearFolder,
}: SettingsDialogProps) {
  // The token is a draft until blur, so a long token is not written once per
  // keystroke. Clearing it from another control resets the draft.
  const [tokenDraft, setTokenDraft] = useState(settings.token);
  useEffect(() => {
    setTokenDraft(settings.token);
  }, [settings.token]);

  const commitToken = useCallback(() => {
    const token = tokenDraft.trim();
    setTokenDraft(token);
    if (token !== settings.token) onChange({ token });
  }, [onChange, settings.token, tokenDraft]);

  // Esc and the close controls commit the draft first; otherwise a typed token
  // would vanish without a blur.
  const close = useCallback(() => {
    commitToken();
    onClose();
  }, [commitToken, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-head">
          <h2 id="settings-title">Configurações</h2>
          <button type="button" className="icon" onClick={close} aria-label="Fechar Configurações">
            x
          </button>
        </header>

        <section>
          <h3>Image Chest</h3>
          <label className="settings-field">
            <span>Token</span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              onBlur={commitToken}
              placeholder="cole o token pessoal"
              autoComplete="off"
              spellCheck={false}
              aria-label="Token do Image Chest"
            />
          </label>
          <div className="settings-actions">
            <button type="button" onClick={commitToken} disabled={testing}>
              Salvar token
            </button>
            <button
              type="button"
              onClick={() => {
                commitToken();
                onTestConnection();
              }}
              disabled={testing || !tokenDraft.trim()}
            >
              {testing ? 'Testando…' : 'Testar conexão'}
            </button>
            <button
              type="button"
              onClick={onClearToken}
              disabled={testing || !settings.token}
              title="Apaga o token salvo neste computador"
            >
              Limpar token
            </button>
          </div>
          {testResult && (
            <p className={`settings-result ${testResult.ok ? 'ok' : 'bad'}`} role="status">
              {testResult.message}
            </p>
          )}
          <p className="settings-hint">
            O token fica em texto simples na pasta de configuração do app, só neste computador.
          </p>

          <label className="settings-field">
            <span>Privacidade padrão</span>
            <select
              value={settings.defaultPrivacy}
              onChange={(event) =>
                onChange({ defaultPrivacy: event.target.value as Settings['defaultPrivacy'] })
              }
              aria-label="Privacidade padrão do Post"
            >
              {PRIVACY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3>Export</h3>
          <div className="settings-row">
            <span className="settings-key">Pasta</span>
            <code className="settings-path" title={settings.saveFolder ?? 'Downloads'}>
              {settings.saveFolder ?? 'Downloads (padrão)'}
            </code>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={onChooseFolder} disabled={!desktop}>
              Escolher pasta
            </button>
            <button
              type="button"
              onClick={onClearFolder}
              disabled={!settings.saveFolder}
              title="Volta a usar a pasta Downloads"
            >
              Usar Downloads
            </button>
          </div>
          {!desktop && (
            <p className="settings-hint">A pasta só pode ser escolhida no app desktop.</p>
          )}
          <div className="settings-row">
            <span className="settings-key">Formato</span>
            <span>{settings.exportFormat === 'jpg' ? 'JPG' : 'PNG'} · nesta versão o Export é PNG</span>
          </div>
          <div className="settings-row">
            <span className="settings-key">Escala</span>
            <div className="toggle" role="group" aria-label="Escala padrão do Export">
              {([1, 2] as ExportScale[]).map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={settings.exportScale === scale ? 'on' : ''}
                  onClick={() => onChange({ exportScale: scale })}
                >
                  {scale}×
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3>Borda</h3>
          <div className="settings-row">
            <span className="settings-key">Cor</span>
            <span className="settings-color">
              <input
                type="color"
                className="color"
                value={settings.borderColor}
                onChange={(event) => onChange({ borderColor: event.target.value.toUpperCase() })}
                aria-label="Cor da Borda"
              />
              <code>{settings.borderColor}</code>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-key">Largura</span>
            <span className="settings-color">
              <NumberField
                value={settings.borderWidth}
                onCommit={(borderWidth) => onChange({ borderWidth })}
                label="Largura da Borda"
              />
              <span className="unit">px</span>
            </span>
          </div>
          <p className="settings-hint">
            A Borda é desenhada no Export e escala junto com a escala do Export; estes valores
            também são guardados para a próxima sessão.
          </p>
        </section>

        <footer className="settings-foot">
          <span className="settings-hint">Esc fecha</span>
          <button type="button" className="settings-close" onClick={close}>
            Fechar
          </button>
        </footer>
      </div>
    </div>
  );
}
