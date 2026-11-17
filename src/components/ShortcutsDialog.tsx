import { useEffect, useRef } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { useI18n, type I18n } from '../hooks/useI18n';
import { DialogClose } from './DialogClose';

interface Shortcut {
  readonly keys: string;
  readonly label: string;
}

function fileShortcuts(t: I18n['t']): readonly Shortcut[] {
  return [
    { keys: t('shortcuts.openKey'), label: t('shortcuts.open') },
    { keys: t('shortcuts.pasteKey'), label: t('shortcuts.paste') },
    { keys: t('shortcuts.exportKey'), label: t('shortcuts.exportTile') },
    { keys: t('shortcuts.exportAllKey'), label: t('shortcuts.exportAll') },
    { keys: t('shortcuts.uploadKey'), label: t('shortcuts.upload') },
    { keys: t('shortcuts.uploadAllKey'), label: t('shortcuts.uploadAll') },
    { keys: t('shortcuts.settingsKey'), label: t('shortcuts.settings') },
    { keys: t('shortcuts.helpKey'), label: t('shortcuts.help') },
  ];
}

function frameShortcuts(t: I18n['t']): readonly Shortcut[] {
  return [
    { keys: t('shortcuts.adjustFrameKey'), label: t('shortcuts.adjustFrame') },
    { keys: t('shortcuts.toggleFramesKey'), label: t('shortcuts.toggleFrames') },
    { keys: t('shortcuts.playPauseKey'), label: t('shortcuts.playPause') },
    { keys: t('shortcuts.nudgeKey'), label: t('shortcuts.nudge') },
    { keys: t('shortcuts.nudgeFarKey'), label: t('shortcuts.nudgeFar') },
    { keys: t('shortcuts.zoomKey'), label: t('shortcuts.zoom') },
    { keys: t('shortcuts.rotateKey'), label: t('shortcuts.rotate') },
    { keys: t('shortcuts.borderKey'), label: t('shortcuts.border') },
    { keys: t('shortcuts.ratiosKey'), label: t('shortcuts.ratios') },
    { keys: t('shortcuts.escapeKey'), label: t('shortcuts.escape') },
  ];
}

function mouseShortcuts(t: I18n['t']): readonly Shortcut[] {
  return [
    { keys: t('shortcuts.clickKey'), label: t('shortcuts.click') },
    { keys: t('shortcuts.doubleClickKey'), label: t('shortcuts.doubleClick') },
    { keys: t('shortcuts.reorderKey'), label: t('shortcuts.reorder') },
    { keys: t('shortcuts.dragKey'), label: t('shortcuts.drag') },
    { keys: t('shortcuts.wheelCropKey'), label: t('shortcuts.wheelCrop') },
    { keys: t('shortcuts.wheelBoardKey'), label: t('shortcuts.wheelBoard') },
    { keys: t('shortcuts.wheelBoardZoomKey'), label: t('shortcuts.wheelBoardZoom') },
    { keys: t('shortcuts.shiftKey'), label: t('shortcuts.shift') },
    { keys: t('shortcuts.altKey'), label: t('shortcuts.alt') },
  ];
}

function ShortcutList({ items }: { readonly items: readonly Shortcut[] }) {
  return (
    <dl className="shortcut-list">
      {items.map((item) => (
        <div key={item.keys}>
          <dt>
            <kbd>{item.keys}</kbd>
          </dt>
          <dd>{item.label}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutsDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useI18n();
  const modalRef = useRef<HTMLDivElement>(null);
  useDialogFocus(modalRef);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="settings-modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="settings-head">
          <h2 id="shortcuts-title">{t('shortcuts.title')}</h2>
          <DialogClose label={t('shortcuts.closeLabel')} onClick={onClose} />
        </header>

        <div className="shortcuts-cols">
          <div className="shortcuts-col">
            <section>
              <h3>{t('shortcuts.fileSection')}</h3>
              <ShortcutList items={fileShortcuts(t)} />
            </section>
            <section>
              <h3>{t('shortcuts.mouseSection')}</h3>
              <ShortcutList items={mouseShortcuts(t)} />
            </section>
          </div>
          <div className="shortcuts-col">
            <section>
              <h3>{t('shortcuts.frameSection')}</h3>
              <ShortcutList items={frameShortcuts(t)} />
            </section>
          </div>
        </div>

        <footer className="settings-foot">
          <span className="settings-hint">{t('shortcuts.hint')}</span>
          <button type="button" className="settings-close" onClick={onClose}>
            {t('common.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
