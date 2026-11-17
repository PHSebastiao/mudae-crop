import { MUDAE_RATIO, presetForRatio, ratioLabel } from '../core/ratios';
import { useI18n } from '../hooks/useI18n';

interface EmptyBoardProps {
  /** The Frame proportion a new Tile starts at. */
  readonly ratio: number;
  readonly busy: boolean;
  readonly onOpen: () => void;
}

/**
 * The Board with no Tiles. It owns the whole workspace: there is nothing to
 * frame, so it invites a batch instead of showing two empty columns.
 */
export function EmptyBoard({ ratio, busy, onOpen }: EmptyBoardProps) {
  const { t } = useI18n();
  const preset = presetForRatio(ratio) ?? null;
  const label = ratioLabel(ratio || MUDAE_RATIO, t('ratio.custom'));
  return (
    <div className="stage-empty">
      <div className="stage-empty-card">
        <div className="stage-empty-art" aria-hidden="true">
          <div className="stage-empty-frame" style={{ aspectRatio: String(ratio) }}>
            <svg viewBox="0 0 16 16" focusable="false">
              <path
                d="M2 11.5 5.8 7.7l2.6 2.6 2.1-2.1L14 11.6M2 2.5h12v11H2z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <div className="stage-empty-copy">
          <h1>{t('empty.title')}</h1>
          <p className="stage-empty-sub">
            {preset ? t('empty.subtitlePreset', { label }) : t('empty.subtitle')}
          </p>
          <button
            type="button"
            className="primary stage-empty-cta"
            onClick={onOpen}
            disabled={busy}
          >
            {t('empty.open')}
          </button>
          <p className="stage-empty-hint">
            {t('empty.hintBefore')} <kbd>Ctrl</kbd>+<kbd>V</kbd> {t('empty.hintAfter')}
          </p>
          <p className="stage-empty-formats">{t('app.dropFormats')}</p>
        </div>
      </div>
    </div>
  );
}
