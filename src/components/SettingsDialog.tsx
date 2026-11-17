import { useCallback, useEffect, useRef, useState } from 'react';
import { IMAGE_CHEST_API_KEY_URL, PRIVACY_VALUES, type Privacy } from '../core/imagechest';
import { LOCALES, LOCALE_LABELS, type Locale } from '../core/i18n/locale';
import type { TextRef } from '../core/i18n/text';
import type { Settings } from '../core/settings';
import { describeUpdate, type UpdateStatus } from '../core/update';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useI18n } from '../hooks/useI18n';
import { DialogClose } from './DialogClose';
import { NumberField } from './NumberField';

export interface TokenTestResult {
  readonly ok: boolean;
  readonly message: TextRef;
}

interface SettingsDialogProps {
  readonly settings: Settings;
  readonly desktop: boolean;
  readonly testing: boolean;
  readonly testResult: TokenTestResult | null;
  readonly checkingAccount: boolean;
  /** This build's version, or null until it is read. */
  readonly version: string | null;
  readonly updateStatus: UpdateStatus;
  readonly onChange: (patch: Partial<Settings>) => void;
  readonly onClose: () => void;
  readonly onTestConnection: () => void;
  readonly onCheckAccount: () => void;
  readonly onClearToken: () => void;
  readonly onOpenApiKeyPage: () => void;
  readonly onChooseFolder: () => void;
  readonly onClearFolder: () => void;
  readonly onCheckUpdate: () => void;
  readonly onOpenRepository: () => void;
  /** Close Settings and open the onboarding tour. */
  readonly onReplayTour: () => void;
}

export function SettingsDialog({
  settings,
  desktop,
  testing,
  testResult,
  checkingAccount,
  version,
  updateStatus,
  onChange,
  onClose,
  onTestConnection,
  onCheckAccount,
  onClearToken,
  onOpenApiKeyPage,
  onChooseFolder,
  onClearFolder,
  onCheckUpdate,
  onOpenRepository,
  onReplayTour,
}: SettingsDialogProps) {
  const { t, tr } = useI18n();
  // The token is a draft until blur, so a long token is not written once per
  // keystroke. Clearing it from another control resets the draft.
  const [tokenDraft, setTokenDraft] = useState(settings.token);
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);
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

  const privacyLabel: Readonly<Record<Privacy, string>> = {
    hidden: t('privacy.hidden'),
    public: t('privacy.public'),
    secret: t('privacy.secret'),
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-head">
          <h2 id="settings-title">{t('settings.title')}</h2>
          <DialogClose label={t('settings.close')} onClick={close} />
        </header>

        <section>
          <h3>{t('settings.sectionLanguage')}</h3>
          <label className="settings-field">
            <span>{t('settings.languageLabel')}</span>
            <select
              value={settings.language}
              onChange={(event) => onChange({ language: event.target.value as Locale })}
              aria-label={t('settings.languageLabel')}
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_LABELS[locale]}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-hint">{t('settings.languageHint')}</p>
        </section>

        <section>
          <h3>{t('settings.sectionImageChest')}</h3>

          <div className="settings-group">
            <h4 className="settings-group-title">{t('settings.groupConnection')}</h4>
            <label className="settings-field">
              <span>{t('settings.tokenLabel')}</span>
              <input
                type="password"
                value={tokenDraft}
                onChange={(event) => setTokenDraft(event.target.value)}
                onBlur={commitToken}
                placeholder={t('settings.tokenPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                aria-label={t('settings.tokenAria')}
              />
            </label>
            <p className="settings-hint">
              {t('settings.tokenSavedHere')}{' '}
              <a
                className="inline-link"
                href={IMAGE_CHEST_API_KEY_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenApiKeyPage();
                }}
              >
                {t('settings.generateToken')}
              </a>
            </p>
            <div className="settings-actions">
              <button
                type="button"
                onClick={() => {
                  commitToken();
                  onTestConnection();
                }}
                disabled={testing || !tokenDraft.trim()}
              >
                {testing ? t('settings.testing') : t('settings.testConnection')}
              </button>
              <button
                type="button"
                className="danger-ghost"
                onClick={onClearToken}
                disabled={testing || !settings.token}
                title={t('settings.clearTokenTitle')}
              >
                {t('settings.clearToken')}
              </button>
            </div>
            {testResult && (
              <p className={`settings-result ${testResult.ok ? 'ok' : 'bad'}`} role="status">
                {tr(testResult.message)}
              </p>
            )}
          </div>

          <div className="settings-group">
            <h4 className="settings-group-title">{t('settings.groupUpload')}</h4>
            <label className="settings-field">
              <span>{t('settings.defaultPrivacy')}</span>
              <select
                value={settings.defaultPrivacy}
                onChange={(event) =>
                  onChange({ defaultPrivacy: event.target.value as Settings['defaultPrivacy'] })
                }
                aria-label={t('settings.defaultPrivacyAria')}
              >
                {PRIVACY_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {privacyLabel[value]}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-check">
              <input
                type="checkbox"
                checked={settings.uploadCredit}
                onChange={(event) => onChange({ uploadCredit: event.target.checked })}
              />
              <span>{t('settings.credit')}</span>
            </label>
            <p className="settings-hint">{t('settings.creditHint')}</p>

            <div className="settings-row">
              <span className="settings-key">{t('settings.account')}</span>
            </div>
            <div className="settings-row">
              {settings.imageChestGold === true
                ? t('settings.accountGold')
                : settings.imageChestGold === false
                  ? t('settings.accountStandard')
                  : t('settings.accountUnknown')}
            </div>
            <div className="settings-actions">
              <button
                type="button"
                onClick={() => {
                  commitToken();
                  onCheckAccount();
                }}
                disabled={checkingAccount || testing || !tokenDraft.trim()}
                title={t('settings.checkAccountTitle')}
              >
                {checkingAccount ? t('settings.checkingAccount') : t('settings.checkAccount')}
              </button>
            </div>
            <p className="settings-hint">{t('settings.batchHint')}</p>
          </div>
        </section>

        <section>
          <h3>{t('settings.sectionBoard')}</h3>
          <label className="settings-field">
            <span>{t('settings.importMode')}</span>
            <select
              value={settings.importMode}
              onChange={(event) =>
                onChange({ importMode: event.target.value as Settings['importMode'] })
              }
              aria-label={t('settings.importModeAria')}
            >
              <option value="append">{t('settings.importAppend')}</option>
              <option value="replace">{t('settings.importReplace')}</option>
            </select>
          </label>
          <p className="settings-hint">{t('settings.importHint')}</p>
        </section>

        <section>
          <h3>{t('settings.sectionExport')}</h3>
          <div className="settings-row">
            <span className="settings-key">{t('settings.folder')}</span>
            <code className="settings-path" title={settings.saveFolder ?? 'Downloads'}>
              {settings.saveFolder ?? t('settings.downloadsDefault')}
            </code>
          </div>
          <div className="settings-actions">
            <button type="button" onClick={onChooseFolder} disabled={!desktop}>
              {t('settings.chooseFolder')}
            </button>
            <button
              type="button"
              onClick={onClearFolder}
              disabled={!settings.saveFolder}
              title={t('settings.useDownloadsTitle')}
            >
              {t('settings.useDownloads')}
            </button>
          </div>
          {!desktop && <p className="settings-hint">{t('app.folderDesktopOnly')}</p>}
          <div className="settings-row">
            <span className="settings-key">{t('settings.format')}</span>
            <span>{settings.exportFormat.toUpperCase()}</span>
          </div>
          <p className="settings-hint">{t('settings.formatHint')}</p>
        </section>

        <section>
          <h3>{t('settings.sectionBorder')}</h3>
          <div className="settings-row">
            <span className="settings-key">{t('settings.color')}</span>
            <span className="settings-color">
              <input
                type="color"
                className="color"
                value={settings.borderColor}
                onChange={(event) => onChange({ borderColor: event.target.value.toUpperCase() })}
                aria-label={t('settings.borderColorAria')}
              />
              <code>{settings.borderColor}</code>
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-key">{t('settings.width')}</span>
            <span className="settings-color">
              <NumberField
                value={settings.borderWidth}
                onCommit={(borderWidth) => onChange({ borderWidth })}
                label={t('settings.borderWidthLabel')}
              />
              <span className="unit">px</span>
            </span>
          </div>
          <p className="settings-hint">{t('settings.borderHint')}</p>
        </section>

        <section>
          <h3>{t('settings.sectionAbout')}</h3>
          <div className="settings-row">
            <span className="settings-key">{t('settings.version')}</span>
            <span>{version ?? '—'}</span>
          </div>
          <div className="settings-row">
            <span className="settings-key">{t('settings.tour')}</span>
            <button type="button" className="settings-link" onClick={onReplayTour}>
              {t('settings.replayTour')}
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-key">{t('settings.repository')}</span>
            <a
              className="inline-link"
              href="https://github.com/PHSebastiao/mudae-crop"
              onClick={(event) => {
                event.preventDefault();
                onOpenRepository();
              }}
            >
              github.com/PHSebastiao/mudae-crop
            </a>
          </div>
          <div className="settings-row">
            <span className="settings-key">{t('settings.updates')}</span>
            <span className="settings-color">
              <span
                className="update-status"
                title={updateStatus.detail ? tr(updateStatus.detail) : undefined}
              >
                {tr(describeUpdate(updateStatus))}
              </span>
              <button
                type="button"
                className="update-check"
                onClick={onCheckUpdate}
                disabled={
                  !desktop ||
                  updateStatus.phase === 'checking' ||
                  updateStatus.phase === 'downloading' ||
                  updateStatus.phase === 'installing'
                }
                aria-label={t('settings.checkUpdateAria')}
                title={t('settings.checkUpdateTitle')}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path
                    d="M13 8a5 5 0 1 1-1.6-3.7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M13 2.6v2.6h-2.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </span>
          </div>
          <p className="settings-hint">{t('settings.updateHint')}</p>
        </section>

        <footer className="settings-foot">
          <span className="settings-hint">{t('settings.escCloses')}</span>
          <button type="button" className="settings-close" onClick={close}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
