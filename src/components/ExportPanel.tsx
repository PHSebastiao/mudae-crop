import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_EXPORT_SIDE,
  MAX_LOSSY,
  MIN_LOSSY,
  baseOutputSize,
  effectiveSource,
  isAnimated,
  outputSize,
  waifu2xScaleOf,
  type DocumentState,
  type OptimizeSettings,
} from '../core/document';
import { exportKindFor, type SizeEstimate } from '../core/export';
import { nativeSize } from '../core/geometry';
import { formatHistoryDate, type ExportEntry, type HistoryEntry } from '../core/history';
import type { HistoryPreviewLoader } from '../core/historyPreview';
import { isPostId } from '../core/imagechest';
import type { OptimizeResult } from '../core/optimize';
import {
  mudaeExportSize,
  mudaeScaleOf,
  ratioLabel as presetRatioLabel,
  type CartaScale,
} from '../core/ratios';
import type { Settings } from '../core/settings';
import { decimal, formatBytes, wholePercent } from '../core/format';
import {
  MUDAE_SIZE_GUIDANCE_BYTES,
  aspectMatches,
  exceedsSizeGuidance,
  exceedsSource,
  formatAspect,
} from '../core/size';
import { useI18n } from '../hooks/useI18n';
import { NumberField } from './NumberField';
import { ToggleGroup } from './ToggleGroup';

interface ExportPanelProps {
  readonly doc: DocumentState;
  readonly busy: boolean;
  readonly exporting: boolean;
  readonly downloading: boolean;
  readonly uploading: boolean;
  readonly settings: Settings;
  readonly history: readonly HistoryEntry[];
  readonly preview: HistoryPreviewLoader;
  readonly cooldownSeconds: number;
  readonly appendPostId: string;
  readonly optimizeResult: OptimizeResult | null;
  readonly sizeEstimate: SizeEstimate | null;
  readonly waifu2xReady: boolean;
  /** How many Tiles a batch command would act on. */
  readonly tileCount: number;
  readonly samePost: boolean;
  readonly onSamePost: (value: boolean) => void;
  readonly onExport: () => void;
  readonly onExportAll: () => void;
  readonly onExportScale: (scale: CartaScale) => void;
  readonly onExportFormat: (format: 'png' | 'gif') => void;
  readonly onResizeWidth: (width: number) => void;
  readonly onResizeHeight: (height: number) => void;
  readonly onResizeLocked: (locked: boolean) => void;
  readonly onNative: () => void;
  readonly onHalve: () => void;
  readonly onDouble: () => void;
  readonly onOptimize: (patch: Partial<OptimizeSettings>) => void;
  readonly onAppendPostId: (value: string) => void;
  readonly onCommitAppendPostId: () => void;
  readonly onUpload: () => void;
  readonly onUploadAll: () => void;
  readonly onOpenSettings: () => void;
  readonly onCopyText: (value: string) => void;
  readonly onOpenLink: (value: string) => void;
  readonly onRevealPath: (path: string) => void;
  readonly onClearHistory: () => void;
}

interface ExportRowProps {
  readonly entry: ExportEntry;
  readonly preview: HistoryPreviewLoader;
  readonly root: RefObject<HTMLUListElement | null>;
  readonly onCopyText: (value: string) => void;
  readonly onRevealPath: (path: string) => void;
}

/**
 * An Export row reads its file only once the row is near the visible part of
 * the History list. The chip stays in place while the read is in flight, and
 * becomes the permanent fallback when the file is gone or cannot be decoded.
 */
function ExportRow({ entry, preview, root, onCopyText, onRevealPath }: ExportRowProps) {
  const { locale, t } = useI18n();
  const rowRef = useRef<HTMLLIElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || failed) return;
    const row = rowRef.current;
    if (!row) return;

    let alive = true;
    const startRead = () => {
      void preview.load(entry).then(
        (next) => {
          if (alive) setUrl(next);
        },
        () => {
          if (alive) setFailed(true);
        },
      );
    };

    if (typeof IntersectionObserver === 'undefined') {
      startRead();
      return () => {
        alive = false;
      };
    }

    const observer = new IntersectionObserver(
      (records) => {
        if (!records.some((record) => record.isIntersecting)) return;
        observer.disconnect();
        startRead();
      },
      { root: root.current, rootMargin: '80px' },
    );
    observer.observe(row);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [entry, failed, preview, root, url]);

  const format = entry.format.toUpperCase();

  return (
    <li ref={rowRef}>
      {url && !failed ? (
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="history-file">{format}</span>
      )}
      <div className="history-body">
        <span className="history-link" title={entry.path}>
          {entry.fileName}
        </span>
        <span className="history-meta">
          {t('export.rowMeta', {
            format,
            width: entry.width,
            height: entry.height,
            size: formatBytes(entry.size, locale),
          })}
        </span>
        <div className="history-foot">
          <span className="history-meta">{formatHistoryDate(entry.createdAt, locale)}</span>
          <span className="history-actions">
            <button
              type="button"
              onClick={() => onCopyText(entry.path)}
              title={t('export.copyPathTitle')}
            >
              {t('export.copy')}
            </button>
            <button
              type="button"
              onClick={() => onRevealPath(entry.path)}
              title={t('export.revealTitle')}
            >
              {t('export.reveal')}
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

export const ExportPanel = memo(function ExportPanel({
  doc,
  busy,
  exporting,
  downloading,
  uploading,
  settings,
  history,
  preview,
  cooldownSeconds,
  appendPostId,
  optimizeResult,
  sizeEstimate,
  waifu2xReady,
  tileCount,
  samePost,
  onSamePost,
  onExport,
  onExportAll,
  onExportScale,
  onExportFormat,
  onResizeWidth,
  onResizeHeight,
  onResizeLocked,
  onNative,
  onHalve,
  onDouble,
  onOptimize,
  onAppendPostId,
  onCommitAppendPostId,
  onUpload,
  onUploadAll,
  onOpenSettings,
  onCopyText,
  onOpenLink,
  onRevealPath,
  onClearHistory,
}: ExportPanelProps) {
  const { locale, t, tr } = useI18n();
  const size = outputSize(doc);
  const baseSize = baseOutputSize(doc);
  const waifuScale = waifu2xScaleOf(doc);
  // 2× and 4× define the final pixels, so the manual size controls would
  // contradict the sidecar's own upscale. They stay visible but disabled.
  const waifuLocked = waifuScale > 1;
  const waifuUnavailable = doc.waifu2x.enabled && !waifu2xReady;
  const native = nativeSize(doc);
  const card1 = mudaeExportSize(doc.frame.ratio, 1);
  const card2 = mudaeExportSize(doc.frame.ratio, 2);
  const isMudae = card1 !== null;
  // The automatic state is Nativo; a Carta or a hand-typed size is an
  // explicit Resize. A custom size stays on the third option and keeps its
  // fields visible even when it does not match a Carta.
  const mudaeScale = doc.resize !== null ? mudaeScaleOf(size, doc.frame.ratio) : null;
  const explicit = doc.resize !== null;
  // The custom block stays open once the user is editing it, so a Mudae size
  // that happens to land on a Carta does not unmount the fields mid-typing.
  const [customOpen, setCustomOpen] = useState(false);
  const customSelected = explicit && mudaeScale === null;
  const showCustom = doc.source !== null && (!isMudae || customOpen || customSelected);
  const aboveNative = exceedsSource(size, native);
  const nativeCapped = native.width > MAX_EXPORT_SIDE || native.height > MAX_EXPORT_SIDE;
  const sizeCapTitle = t('export.sizeCapTitle', { side: MAX_EXPORT_SIDE });
  const postId = appendPostId.trim();
  const badPostId = postId !== '' && !isPostId(postId);
  const hasToken = settings.token.trim() !== '';
  const cooling = cooldownSeconds > 0;
  const uploadDisabled =
    !doc.source || busy || cooling || badPostId || !hasToken || waifuUnavailable;
  const kind = exportKindFor(effectiveSource(doc), settings.exportFormat);
  const format = kind.label;
  const animated = isAnimated(effectiveSource(doc));
  const ratioMatches = aspectMatches(size, doc.frame.ratio);
  const aspectLabel = formatAspect(size, locale);
  const exportLabel = downloading
    ? t('export.awaitLink')
    : exporting
      ? t('export.exporting')
      : t('export.export', { format });
  const optimize = doc.optimize;
  const optimizeGain =
    optimizeResult && optimizeResult.baseSize > 0
      ? Math.round((1 - optimizeResult.size / optimizeResult.baseSize) * 100)
      : 0;
  const estimatedBytes = sizeEstimate?.bytes ?? null;
  // Optimize can miss its target, so a capped estimate is an upper bound, not
  // a promise. Everything extrapolated is marked with "~".
  const cappedByTarget =
    kind.format === 'gif' &&
    optimize.enabled &&
    optimize.targetEnabled &&
    sizeEstimate !== null &&
    !sizeEstimate.exact &&
    estimatedBytes === optimize.targetBytes;
  const bytesLabel = estimatedBytes === null ? null : formatBytes(estimatedBytes, locale);
  const estimateLabel =
    bytesLabel === null
      ? null
      : cappedByTarget
        ? t('export.estimateCapped', { size: bytesLabel })
        : sizeEstimate?.exact
          ? bytesLabel
          : t('export.estimateApproximate', { size: bytesLabel });
  const estimateTitle = doc.source?.video
    ? t('export.estimateVideoTitle')
    : sizeEstimate?.exact
      ? t('export.estimateExactTitle')
      : t('export.estimateTitle');
  const overGuidance = exceedsSizeGuidance(estimatedBytes);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const postPrivacy: Record<string, string> = {
    hidden: t('export.postHidden'),
    public: t('export.postPublic'),
    secret: t('export.postSecret'),
  };

  // Clearing the History, or the 50-entry cap evicting an old row, releases
  // that row's object URL. Rows still in the list keep their cached thumbnail.
  useEffect(() => {
    preview.retain(history.filter((entry): entry is ExportEntry => entry.kind === 'export'));
  }, [history, preview]);

  const actions = (
    <div className="panel-actions">
      {waifuUnavailable && <p className="panel-hint bad">{t('export.waifuUnavailable')}</p>}
      <button
        type="button"
        className="big primary"
        onClick={onExport}
        disabled={!doc.source || busy || waifuUnavailable}
      >
        {exportLabel}
      </button>
      <button
        type="button"
        className="big ghost"
        onClick={hasToken ? onUpload : onOpenSettings}
        disabled={hasToken ? uploadDisabled : busy}
        title={
          !doc.source
            ? t('export.uploadNoSourceTitle')
            : waifuUnavailable
              ? t('export.uploadWaifuTitle')
              : !hasToken
                ? t('export.uploadNoTokenTitle')
                : badPostId
                  ? t('export.uploadBadPostTitle')
                  : t('export.uploadTitle')
        }
      >
        {!hasToken
          ? t('export.configureToken')
          : uploading
            ? t('export.uploading')
            : cooling
              ? t('export.cooldown', { seconds: cooldownSeconds })
              : t('export.upload')}
      </button>
      {tileCount > 1 && (
        <div className="batch-actions">
          <button
            type="button"
            className="batch-button"
            onClick={onExportAll}
            disabled={busy || waifuUnavailable}
            title={t('export.exportAllTitle')}
          >
            {t('export.exportAll', { count: tileCount })}
          </button>
          <button
            type="button"
            className="batch-button"
            onClick={hasToken ? onUploadAll : onOpenSettings}
            disabled={hasToken ? uploadDisabled : busy}
            title={samePost ? t('export.uploadAllOnePostTitle') : t('export.uploadAllPerTileTitle')}
          >
            {hasToken ? t('export.uploadAll', { count: tileCount }) : t('export.uploadAllToken')}
          </button>
        </div>
      )}
      <p className="panel-hint">{hasToken ? t('export.hintWithToken') : t('export.hint')}</p>
    </div>
  );

  return (
    <aside className="panel" id="tour-export">
      <div className="panel-scroll">
        <section>
          <h4>{t('export.heading')}</h4>

          <div className="export-summary" aria-live="polite">
            <div className="export-summary-row">
              <strong>
                {format}
                <span className="export-summary-dims">
                  {doc.source ? `${size.width}×${size.height}` : t('export.noDimensions')}
                </span>
                {estimateLabel && (
                  <span className="export-summary-size" title={estimateTitle}>
                    {estimateLabel}
                  </span>
                )}
              </strong>
            </div>
            <div className="export-summary-row export-summary-foot">
              <span className={ratioMatches ? '' : 'warn'}>
                {ratioMatches ? t('export.ratioCard') : t('export.ratioStretched')}
              </span>
              {optimizeResult && (
                <span>
                  {t('export.optimized', { size: formatBytes(optimizeResult.size, locale) })}
                </span>
              )}
            </div>
            {doc.source && (
              <div className="export-summary-row export-summary-foot">
                <span>
                  {t('export.sourceMeta', {
                    format: doc.source.format.toUpperCase(),
                    width: doc.source.width,
                    height: doc.source.height,
                  })}
                </span>
              </div>
            )}
          </div>

          {overGuidance && (
            <p className="panel-hint warn">
              {t('export.overGuidance', {
                estimate: estimateLabel ?? '',
                limit: formatBytes(MUDAE_SIZE_GUIDANCE_BYTES, locale),
              })}
              {kind.format === 'gif'
                ? t('export.overGuidanceGif')
                : t('export.overGuidanceReduced')}
            </p>
          )}

          <ToggleGroup
            label={t('export.formatLabel')}
            value={kind.format}
            onChange={onExportFormat}
            options={[
              { value: 'png', label: t('export.formatPng'), title: t('export.formatPngTitle') },
              {
                value: 'gif',
                label: t('export.formatGif'),
                title: animated
                  ? t('export.formatGifAnimatedTitle')
                  : t('export.formatGifStaticTitle'),
                disabled: !animated,
              },
            ]}
          />
          {!animated && <p className="panel-hint">{t('export.gifNeedsAnimation')}</p>}

          <div className="size-label">{t('export.sizeHeading')}</div>
          {isMudae && card1 && card2 && (
            <div className="export-sizes" role="radiogroup" aria-label={t('export.sizeLabel')}>
              <button
                type="button"
                className={`size-option${mudaeScale === 1 ? ' on' : ''}`}
                onClick={() => {
                  setCustomOpen(false);
                  onExportScale(1);
                }}
                role="radio"
                aria-checked={!waifuLocked && mudaeScale === 1}
                disabled={!doc.source || waifuLocked}
              >
                <span>{t('export.carta1')}</span>
                <span className="dims">
                  {card1.width}×{card1.height}
                </span>
              </button>
              <button
                type="button"
                className={`size-option${mudaeScale === 2 ? ' on' : ''}`}
                onClick={() => {
                  setCustomOpen(false);
                  onExportScale(2);
                }}
                role="radio"
                aria-checked={!waifuLocked && mudaeScale === 2}
                title={t('export.carta2Title')}
                disabled={!doc.source || waifuLocked}
              >
                <span>{t('export.carta2')}</span>
                <span className="dims">
                  {card2.width}×{card2.height}
                </span>
              </button>
              <button
                type="button"
                className={`size-option${mudaeScale === null ? ' on' : ''}`}
                onClick={() => {
                  if (explicit) {
                    setCustomOpen(true);
                    if (mudaeScale !== null) onNative();
                  } else {
                    setCustomOpen(false);
                    onNative();
                  }
                }}
                role="radio"
                aria-checked={!waifuLocked && mudaeScale === null}
                title={explicit ? t('export.customSizeTitle') : t('export.autoSizeTitle')}
                disabled={!doc.source || waifuLocked}
              >
                <span>{explicit ? t('export.custom') : t('export.native')}</span>
                {!explicit && doc.source && (
                  <span className="dims">
                    {native.width}×{native.height}
                  </span>
                )}
              </button>
            </div>
          )}

          {isMudae && !showCustom && (
            <button type="button" className="link size-edit" onClick={() => setCustomOpen(true)}>
              {t('export.customSize')}
            </button>
          )}

          {showCustom && (
            <div className="custom-size">
              <div className="custom-size-head">
                <NumberField
                  value={waifuLocked ? baseSize.width : size.width}
                  onCommit={(width) => {
                    setCustomOpen(true);
                    onResizeWidth(width);
                  }}
                  label={t('export.widthLabel')}
                  title={sizeCapTitle}
                  disabled={!doc.source || waifuLocked}
                />
                <button
                  type="button"
                  className={`lock${doc.resizeLocked ? ' on' : ''}`}
                  onClick={() => onResizeLocked(!doc.resizeLocked)}
                  disabled={!doc.source || waifuLocked}
                  aria-pressed={doc.resizeLocked}
                  aria-label={t('export.lockLabel')}
                  title={doc.resizeLocked ? t('export.lockedTitle') : t('export.unlockedTitle')}
                >
                  {doc.resizeLocked ? (
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <rect
                        x="3.25"
                        y="7"
                        width="9.5"
                        height="6.25"
                        rx="1.4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                      <path
                        d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <rect
                        x="3.25"
                        y="7"
                        width="9.5"
                        height="6.25"
                        rx="1.4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                      />
                      <path
                        d="M5.5 7V5a2.5 2.5 0 0 1 4.7-1.1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </button>
                <NumberField
                  value={waifuLocked ? baseSize.height : size.height}
                  onCommit={(height) => {
                    setCustomOpen(true);
                    onResizeHeight(height);
                  }}
                  label={t('export.heightLabel')}
                  title={sizeCapTitle}
                  disabled={!doc.source || waifuLocked}
                />
              </div>
              <div className="custom-size-meta">
                {doc.source && (
                  <span className="ratio-chip">
                    {ratioMatches
                      ? presetRatioLabel(doc.frame.ratio, t('ratio.custom'))
                      : aspectLabel}
                  </span>
                )}
                <span>
                  {!doc.source
                    ? t('export.noSource')
                    : explicit
                      ? t('export.customState')
                      : t('export.autoState')}
                </span>
              </div>
              <div className="custom-size-actions">
                {!isMudae && (
                  <button
                    type="button"
                    onClick={onNative}
                    title={t('export.nativeTitle')}
                    disabled={!doc.source || waifuLocked}
                  >
                    {t('export.native')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onHalve}
                  title={t('export.halveTitle')}
                  disabled={!doc.source || waifuLocked}
                >
                  {t('export.halve')}
                </button>
                <button
                  type="button"
                  onClick={onDouble}
                  title={t('export.doubleTitle')}
                  disabled={!doc.source || waifuLocked}
                >
                  {t('export.double')}
                </button>
              </div>
              {waifuLocked && (
                <p className="panel-hint">
                  {t('export.waifuLockedHint', {
                    scale: waifuScale,
                    width: baseSize.width,
                    height: baseSize.height,
                  })}
                </p>
              )}
              {!doc.resizeLocked && !ratioMatches && (
                <p className="panel-hint bad">{t('export.offRatioHint')}</p>
              )}
            </div>
          )}

          {nativeCapped && (
            <p className="panel-hint warn">
              {t('export.nativeCappedHint', {
                width: native.width,
                height: native.height,
                side: MAX_EXPORT_SIDE,
              })}
            </p>
          )}

          {showCustom && explicit && aboveNative && (
            <p className="panel-hint warn">{t('export.aboveNativeHint')}</p>
          )}

          {aboveNative && !(showCustom && explicit) && doc.source && (
            <p className="panel-hint warn">{t('export.aboveNativeOnlyHint')}</p>
          )}

          {animated && kind.format === 'gif' && isMudae && mudaeScale === 2 && (
            <p className="panel-hint">
              {t('export.carta2GifHint', { limit: formatBytes(MUDAE_SIZE_GUIDANCE_BYTES, locale) })}
            </p>
          )}

          {animated && kind.format === 'gif' && (
            <div className="optimize-block">
              <button
                type="button"
                className="section-toggle"
                onClick={() => setOptimizeOpen((open) => !open)}
                aria-expanded={optimizeOpen}
              >
                <span>{t('export.optimizeHeading')}</span>
                <span>
                  {optimize.enabled
                    ? optimize.targetEnabled
                      ? t('export.optimizeOnTarget', {
                          size: decimal(optimize.targetBytes / (1024 * 1024), 1, locale),
                        })
                      : t('export.optimizeOnNoTarget')
                    : t('export.optimizeOff')}{' '}
                  {optimizeOpen ? '▾' : '▸'}
                </span>
              </button>
              {optimizeOpen && (
                <>
                  <ToggleGroup
                    label={t('export.optimizeHeading')}
                    value={optimize.enabled ? 'on' : 'off'}
                    onChange={(next) => onOptimize({ enabled: next === 'on' })}
                    options={[
                      { value: 'off', label: t('export.optimizeOff') },
                      { value: 'on', label: t('export.optimizeOn') },
                    ]}
                  />
                  {optimize.enabled && (
                    <>
                      <label className="row">
                        <span className="key">{t('export.useTarget')}</span>
                        <input
                          type="checkbox"
                          checked={optimize.targetEnabled}
                          onChange={(event) => onOptimize({ targetEnabled: event.target.checked })}
                        />
                      </label>
                      {optimize.targetEnabled ? (
                        <div className="row">
                          <span className="key">{t('export.targetMb')}</span>
                          <NumberField
                            value={optimize.targetBytes / (1024 * 1024)}
                            onCommit={(mb) => onOptimize({ targetBytes: mb * 1024 * 1024 })}
                            label={t('export.targetMbLabel')}
                            precision={1}
                          />
                        </div>
                      ) : (
                        <p className="panel-hint">
                          {t('export.noTargetHint', {
                            limit: formatBytes(MUDAE_SIZE_GUIDANCE_BYTES, locale),
                          })}
                        </p>
                      )}
                      <div className="row">
                        <span className="key">{t('export.compression')}</span>
                        <span className="pill">{optimize.lossy}</span>
                      </div>
                      <input
                        className="slider"
                        type="range"
                        min={MIN_LOSSY}
                        max={MAX_LOSSY}
                        step={5}
                        value={optimize.lossy}
                        onChange={(event) => onOptimize({ lossy: Number(event.target.value) })}
                        aria-label={t('export.lossyLabel')}
                      />
                      <ToggleGroup
                        label={t('export.compressionLevel')}
                        value={optimize.lossy}
                        onChange={(lossy) => onOptimize({ lossy })}
                        options={[
                          { value: 30, label: t('export.levelLight') },
                          { value: 100, label: t('export.levelMedium') },
                          { value: 200, label: t('export.levelMax') },
                        ]}
                      />
                      <label className="row">
                        <span className="key">{t('export.reduceColors')}</span>
                        <input
                          type="checkbox"
                          checked={optimize.reduceColors}
                          onChange={(event) => onOptimize({ reduceColors: event.target.checked })}
                        />
                      </label>
                      {optimize.reduceColors && (
                        <div className="row">
                          <span className="key">{t('export.colors')}</span>
                          <NumberField
                            value={optimize.colors}
                            onCommit={(colors) => onOptimize({ colors })}
                            label={t('export.colorsLabel')}
                          />
                        </div>
                      )}
                      <p className="panel-hint">{t('export.lossyHint', { max: MAX_LOSSY })}</p>
                    </>
                  )}
                </>
              )}
              {optimizeResult && (
                <p className={`panel-hint${optimizeResult.met === false ? ' bad' : ''}`}>
                  {optimizeResult.met === null
                    ? t('export.resultApplied')
                    : optimizeResult.met
                      ? t('export.resultMet')
                      : t('export.resultMissed')}
                  {optimizeResult.size >= optimizeResult.baseSize
                    ? t('export.resultNoGain')
                    : t('export.resultGain', {
                        base: formatBytes(optimizeResult.baseSize, locale),
                        size: formatBytes(optimizeResult.size, locale),
                        gain: wholePercent(optimizeGain, locale),
                      })}{' '}
                  {t('export.resultLossy', { lossy: optimizeResult.lossy })}
                  {optimizeResult.colors
                    ? t('export.resultColors', { colors: optimizeResult.colors })
                    : ''}
                  {optimizeResult.droppedFrames > 0
                    ? t('export.resultDropped', { frames: optimizeResult.droppedFrames })
                    : ''}
                  {optimizeResult.error ? ` · ${tr(optimizeResult.error)}` : ''}
                </p>
              )}
            </div>
          )}
        </section>

        {hasToken && (
          <details className="panel-disclosure">
            <summary>
              <h4>{t('export.imageChest')}</h4>
              <span title={t('export.privacyTitle')}>
                {postId
                  ? t('export.postId', { id: postId })
                  : (postPrivacy[settings.defaultPrivacy] ?? t('export.postHidden'))}
              </span>
            </summary>
            <div className="panel-disclosure-body">
              <input
                className="post-id"
                type="text"
                value={appendPostId}
                onChange={(event) => onAppendPostId(event.target.value)}
                onBlur={onCommitAppendPostId}
                placeholder={t('export.postIdPlaceholder')}
                aria-label={t('export.postIdLabel')}
                aria-invalid={badPostId}
                spellCheck={false}
                disabled={busy}
              />
              {badPostId && <p className="panel-hint bad">{t('app.postIdInvalid')}</p>}
              {tileCount > 1 && (
                <label className="row">
                  <span className="key">{t('export.samePost')}</span>
                  <input
                    type="checkbox"
                    checked={samePost}
                    onChange={(event) => onSamePost(event.target.checked)}
                    disabled={busy}
                    title={t('export.samePostTitle')}
                  />
                </label>
              )}
            </div>
          </details>
        )}

        <details className="panel-disclosure">
          <summary>
            <h4>{t('export.history')}</h4>
            <span>
              {history.length === 0
                ? t('export.historyEmpty')
                : t(history.length === 1 ? 'export.historyItem' : 'export.historyItems', {
                    count: history.length,
                  })}
            </span>
          </summary>
          <div className="panel-disclosure-body">
            <div className="section-head">
              <span className="panel-hint">{t('export.historyHint')}</span>
              <button
                type="button"
                className="link"
                onClick={onClearHistory}
                disabled={history.length === 0}
              >
                {t('export.clear')}
              </button>
            </div>
            {history.length === 0 ? (
              <p className="panel-hint">{t('export.historyNone')}</p>
            ) : (
              <ul className="history" ref={listRef}>
                {history.map((entry) =>
                  entry.kind === 'upload' ? (
                    <li key={`upload-${entry.imageId}-${entry.createdAt}`}>
                      <img src={entry.link} alt="" loading="lazy" />
                      <div className="history-body">
                        <span className="history-link" title={entry.link}>
                          {entry.link.replace(/^https:\/\//, '')}
                        </span>
                        <span className="history-meta">
                          {t('export.uploadMeta', {
                            format: entry.format.toUpperCase(),
                            post: entry.postId,
                            size: formatBytes(entry.size, locale),
                          })}
                        </span>
                        <span className="history-meta">
                          {formatHistoryDate(entry.createdAt, locale)}
                        </span>
                        <span className="history-actions">
                          <button type="button" onClick={() => onCopyText(entry.link)}>
                            {t('export.copy')}
                          </button>
                          <button type="button" onClick={() => onOpenLink(entry.link)}>
                            {t('export.open')}
                          </button>
                        </span>
                      </div>
                    </li>
                  ) : (
                    <ExportRow
                      key={`export-${entry.path}-${entry.createdAt}`}
                      entry={entry}
                      preview={preview}
                      root={listRef}
                      onCopyText={onCopyText}
                      onRevealPath={onRevealPath}
                    />
                  ),
                )}
              </ul>
            )}
          </div>
        </details>
      </div>

      {actions}
    </aside>
  );
});
