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
import { formatBytes } from '../core/download';
import {
  MUDAE_SIZE_GUIDANCE_BYTES,
  aspectMatches,
  exceedsSizeGuidance,
  exceedsSource,
  formatAspect,
} from '../core/size';
import { NumberField } from './NumberField';

interface ExportPanelProps {
  readonly doc: DocumentState;
  readonly busy: boolean;
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
  readonly onExport: () => void;
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
        <span className="history-meta" title={entry.path}>
          {entry.path}
        </span>
        <span className="history-meta">
          {format} · {entry.width}×{entry.height} · {formatBytes(entry.size)}
        </span>
        <span className="history-meta">{formatHistoryDate(entry.createdAt)}</span>
        <span className="history-actions">
          <button type="button" onClick={() => onCopyText(entry.path)} title="Copiar caminho">
            copiar
          </button>
          <button
            type="button"
            onClick={() => onRevealPath(entry.path)}
            title="Abrir no Explorador"
          >
            explorador
          </button>
        </span>
      </div>
    </li>
  );
}

export const ExportPanel = memo(function ExportPanel({
  doc,
  busy,
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
  onExport,
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
  onOpenSettings,
  onCopyText,
  onOpenLink,
  onRevealPath,
  onClearHistory,
}: ExportPanelProps) {
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
  // The automatic/native state is deliberately Personalizado, even if the
  // covered pixels happen to equal a Carta size.
  const mudaeScale = doc.resize !== null ? mudaeScaleOf(size, doc.frame.ratio) : null;
  const explicit = doc.resize !== null;
  // The custom block stays open once the user is editing it, so a Mudae size
  // that happens to land on a Carta does not unmount the fields mid-typing.
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = doc.source !== null && (!isMudae || customOpen || mudaeScale === null);
  const aboveNative = exceedsSource(size, native);
  const nativeCapped = native.width > MAX_EXPORT_SIDE || native.height > MAX_EXPORT_SIDE;
  const sizeCapTitle = `Limite de renderização: ${MAX_EXPORT_SIDE} px por lado (memória do canvas/GIF, não é uma regra do Mudae).`;
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
  const aspectLabel = formatAspect(size);
  const exportLabel = downloading
    ? 'Aguarde o link…'
    : busy && !uploading
      ? 'Exportando…'
      : `Exportar ${format}`;
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
  const estimateLabel =
    estimatedBytes === null
      ? null
      : cappedByTarget
        ? `≤ ${formatBytes(estimatedBytes)}`
        : `${sizeEstimate?.exact ? '' : '~'}${formatBytes(estimatedBytes)}`;
  const estimateTitle = doc.source?.video
    ? 'Estimativa pelo frame atual; um vídeo em movimento pode ficar maior'
    : sizeEstimate?.exact
      ? 'Tamanho do arquivo'
      : 'Tamanho estimado; a otimização pode mudar o resultado';
  const overGuidance = exceedsSizeGuidance(estimatedBytes);
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Clearing the History, or the 50-entry cap evicting an old row, releases
  // that row's object URL. Rows still in the list keep their cached thumbnail.
  useEffect(() => {
    preview.retain(history.filter((entry): entry is ExportEntry => entry.kind === 'export'));
  }, [history, preview]);

  return (
    <aside className="panel">
      <div className="panel-scroll">
        <section>
          <h4>Export</h4>

          <div className="export-summary" aria-live="polite">
            <strong>
              {format} · {doc.source ? `${size.width}×${size.height}` : '—'}
            </strong>
            {doc.source && (
              <span className={ratioMatches ? '' : 'warn'}>
                {ratioMatches ? 'proporção da carta' : 'esticada'}
              </span>
            )}
            {estimateLabel && <span title={estimateTitle}>{estimateLabel}</span>}
            {optimizeResult && <span>resultado {formatBytes(optimizeResult.size)}</span>}
          </div>

          {overGuidance && (
            <p className="panel-hint warn">
              {estimateLabel} passa dos {formatBytes(MUDAE_SIZE_GUIDANCE_BYTES)} recomendados pelo
              Mudae.
              {kind.format === 'gif'
                ? ' Otimize o GIF para reduzir; o upload continua liberado.'
                : ' O upload continua liberado; reduza a escala para um arquivo menor.'}
            </p>
          )}

          <div className="toggle" role="group" aria-label="Formato do Export">
            <button
              type="button"
              className={kind.format === 'png' ? 'on' : ''}
              onClick={() => onExportFormat('png')}
            >
              PNG
            </button>
            <button
              type="button"
              className={kind.format === 'gif' ? 'on' : ''}
              onClick={() => onExportFormat('gif')}
              disabled={!animated}
              title={animated ? 'GIF animado' : 'A Source é estática'}
            >
              GIF
            </button>
          </div>
          {!animated && <p className="panel-hint">GIF indisponível: a Source é estática.</p>}

          {isMudae && card1 && card2 && (
            <div className="export-sizes" role="radiogroup" aria-label="Tamanho do Export">
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
                <span>Carta 1×</span>
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
                title="Renderiza a Source em 2×"
                disabled={!doc.source || waifuLocked}
              >
                <span>Carta 2×</span>
                <span className="dims">
                  {card2.width}×{card2.height}
                </span>
              </button>
              <button
                type="button"
                className={`size-option${mudaeScale === null ? ' on' : ''}`}
                onClick={() => {
                  setCustomOpen(false);
                  onNative();
                }}
                role="radio"
                aria-checked={!waifuLocked && mudaeScale === null}
                title={explicit ? 'Tamanho personalizado' : 'Tamanho automático do recorte'}
                disabled={!doc.source || waifuLocked}
              >
                <span>{explicit ? 'Personalizado' : 'Nativo'}</span>
                <span className="dims">
                  {explicit || !doc.source ? '—' : `${native.width}×${native.height}`}
                </span>
              </button>
            </div>
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
                  label="Largura do Export"
                  title={sizeCapTitle}
                  disabled={!doc.source || waifuLocked}
                />
                <button
                  type="button"
                  className={`lock${doc.resizeLocked ? ' on' : ''}`}
                  onClick={() => onResizeLocked(!doc.resizeLocked)}
                  disabled={!doc.source || waifuLocked}
                  aria-pressed={doc.resizeLocked}
                  aria-label="Travar proporção da carta"
                  title={
                    doc.resizeLocked
                      ? 'Proporção da carta travada'
                      : 'Proporção livre — a imagem pode esticar'
                  }
                >
                  {doc.resizeLocked ? '🔒' : '🔓'}
                </button>
                <NumberField
                  value={waifuLocked ? baseSize.height : size.height}
                  onCommit={(height) => {
                    setCustomOpen(true);
                    onResizeHeight(height);
                  }}
                  label="Altura do Export"
                  title={sizeCapTitle}
                  disabled={!doc.source || waifuLocked}
                />
              </div>
              <div className="custom-size-meta">
                {doc.source && (
                  <span className="ratio-chip">
                    {ratioMatches ? presetRatioLabel(doc.frame.ratio) : aspectLabel}
                  </span>
                )}
                <span>
                  {!doc.source ? 'sem Source' : explicit ? 'personalizado' : 'automático'}
                </span>
              </div>
              <div className="custom-size-actions">
                <button
                  type="button"
                  onClick={onNative}
                  title="Tamanho nativo do recorte"
                  disabled={!doc.source || waifuLocked}
                >
                  Nativo
                </button>
                <button
                  type="button"
                  onClick={onHalve}
                  title="Metade do tamanho atual"
                  disabled={!doc.source || waifuLocked}
                >
                  ÷2
                </button>
                <button
                  type="button"
                  onClick={onDouble}
                  title="Dobro do tamanho atual"
                  disabled={!doc.source || waifuLocked}
                >
                  ×2
                </button>
              </div>
              {waifuLocked && (
                <p className="panel-hint">
                  waifu2x {waifuScale}× define o tamanho final · base {baseSize.width}×
                  {baseSize.height}
                </p>
              )}
              {!doc.resizeLocked && !ratioMatches && (
                <p className="panel-hint bad">fora da proporção da carta — a imagem vai esticar</p>
              )}
            </div>
          )}

          {nativeCapped && (
            <p className="panel-hint warn">
              nativo {native.width}×{native.height} · limite de renderização: {MAX_EXPORT_SIDE} px
              por lado
            </p>
          )}

          {showCustom && explicit && aboveNative && (
            <p className="panel-hint warn">acima do nativo — ampliando</p>
          )}

          {aboveNative && !(showCustom && explicit) && doc.source && (
            <p className="panel-hint warn">acima do nativo — só amplia</p>
          )}

          {animated && kind.format === 'gif' && isMudae && mudaeScale === 2 && (
            <p className="panel-hint">
              Carta 2× renderiza a Source maior; o GIF pode passar de{' '}
              {formatBytes(MUDAE_SIZE_GUIDANCE_BYTES)}.
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
                <span>Otimizar GIF</span>
                <span>
                  {optimize.enabled
                    ? optimize.targetEnabled
                      ? `ligado · ${(optimize.targetBytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
                      : 'ligado · sem alvo'
                    : 'desligado'}{' '}
                  {optimizeOpen ? '▾' : '▸'}
                </span>
              </button>
              {optimizeOpen && (
                <>
                  <div className="toggle" role="group" aria-label="Otimizar GIF">
                    <button
                      type="button"
                      className={optimize.enabled ? 'on' : ''}
                      onClick={() => onOptimize({ enabled: !optimize.enabled })}
                    >
                      {optimize.enabled ? 'otimizar ligado' : 'otimizar desligado'}
                    </button>
                  </div>
                  {optimize.enabled && (
                    <>
                      <label className="row">
                        <span className="key">usar alvo</span>
                        <input
                          type="checkbox"
                          checked={optimize.targetEnabled}
                          onChange={(event) => onOptimize({ targetEnabled: event.target.checked })}
                        />
                      </label>
                      {optimize.targetEnabled ? (
                        <div className="row">
                          <span className="key">alvo MB</span>
                          <NumberField
                            value={optimize.targetBytes / (1024 * 1024)}
                            onCommit={(mb) => onOptimize({ targetBytes: mb * 1024 * 1024 })}
                            label="Alvo de tamanho em MB"
                            precision={1}
                          />
                        </div>
                      ) : (
                        <p className="panel-hint">
                          sem alvo — aplica a compressão escolhida, mesmo abaixo de{' '}
                          {formatBytes(MUDAE_SIZE_GUIDANCE_BYTES)}
                        </p>
                      )}
                      <div className="row">
                        <span className="key">compressão</span>
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
                        aria-label="Compressão com lossy"
                      />
                      <div className="toggle" role="group" aria-label="Intensidade da compressão">
                        {[30, 100, 200].map((lossy) => (
                          <button
                            key={lossy}
                            type="button"
                            className={optimize.lossy === lossy ? 'on' : ''}
                            onClick={() => onOptimize({ lossy })}
                          >
                            {lossy === 30 ? 'leve' : lossy === 100 ? 'média' : 'máxima'}
                          </button>
                        ))}
                      </div>
                      <label className="row">
                        <span className="key">reduzir cores</span>
                        <input
                          type="checkbox"
                          checked={optimize.reduceColors}
                          onChange={(event) => onOptimize({ reduceColors: event.target.checked })}
                        />
                      </label>
                      {optimize.reduceColors && (
                        <div className="row">
                          <span className="key">cores</span>
                          <NumberField
                            value={optimize.colors}
                            onCommit={(colors) => onOptimize({ colors })}
                            label="Número de cores"
                          />
                        </div>
                      )}
                      <p className="panel-hint">
                        sem reduzir cores, 100–200 comprime mais · compressão até {MAX_LOSSY}
                      </p>
                    </>
                  )}
                </>
              )}
              {optimizeResult && (
                <p className={`panel-hint${optimizeResult.met === false ? ' bad' : ''}`}>
                  {optimizeResult.met === null
                    ? 'compressão aplicada'
                    : optimizeResult.met
                      ? 'alvo atingido'
                      : 'alvo não atingido'}
                  {optimizeResult.size >= optimizeResult.baseSize ? (
                    <> · sem ganho; original mantido</>
                  ) : (
                    <>
                      {' '}
                      · {formatBytes(optimizeResult.baseSize)} → {formatBytes(optimizeResult.size)}{' '}
                      (−
                      {optimizeGain}%)
                    </>
                  )}{' '}
                  · lossy {optimizeResult.lossy}
                  {optimizeResult.colors ? ` · ${optimizeResult.colors} cores` : ''}
                  {optimizeResult.droppedFrames > 0
                    ? ` · ${optimizeResult.droppedFrames} repetidos`
                    : ''}
                  {optimizeResult.error ? ` · ${optimizeResult.error}` : ''}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="divided">
          <h4>Image Chest</h4>
          <div className="meta">
            <span>post</span>
            <span>{postId ? `append ${postId}` : settings.defaultPrivacy}</span>
          </div>
          <input
            className="post-id"
            type="text"
            value={appendPostId}
            onChange={(event) => onAppendPostId(event.target.value)}
            onBlur={onCommitAppendPostId}
            placeholder="Post id (opcional)"
            aria-label="Post id para anexar o Export"
            aria-invalid={badPostId}
            spellCheck={false}
            disabled={busy}
          />
          {badPostId && <p className="panel-hint bad">O Post id aceita só letras e números.</p>}
        </section>

        <section className="divided">
          <div className="section-head">
            <h4>Histórico</h4>
            <button
              type="button"
              className="link"
              onClick={onClearHistory}
              disabled={history.length === 0}
            >
              limpar
            </button>
          </div>
          {history.length === 0 ? (
            <p className="panel-hint">Nenhum upload ou Export ainda.</p>
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
                        {entry.format.toUpperCase()} · Post {entry.postId} ·{' '}
                        {formatBytes(entry.size)}
                      </span>
                      <span className="history-meta">{formatHistoryDate(entry.createdAt)}</span>
                      <span className="history-actions">
                        <button type="button" onClick={() => onCopyText(entry.link)}>
                          copiar
                        </button>
                        <button type="button" onClick={() => onOpenLink(entry.link)}>
                          abrir
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
        </section>
      </div>

      <div className="panel-actions">
        {!doc.source && <p className="panel-hint">Importe uma Source para exportar.</p>}
        {waifuUnavailable && (
          <p className="panel-hint bad">
            waifu2x indisponível neste computador. Desligue-o para exportar ou subir.
          </p>
        )}
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
          className="big"
          onClick={onUpload}
          disabled={uploadDisabled}
          title={
            !doc.source
              ? 'Importe uma Source primeiro'
              : waifuUnavailable
                ? 'Desligue o waifu2x para subir'
                : !hasToken
                  ? 'Configure o token em Configurações'
                  : badPostId
                    ? 'Confira o Post id'
                    : 'Cria um Post hidden e copia o link direto'
          }
        >
          {uploading ? 'Subindo…' : cooling ? `Aguarde ${cooldownSeconds}s` : 'Subir e copiar link'}
        </button>
        <p className="panel-hint">
          {hasToken
            ? 'Ctrl+S exporta · Ctrl+Enter sobe e copia o link.'
            : 'Ctrl+S exporta. Configure o token para subir.'}
        </p>
        {!hasToken && (
          <button type="button" className="link" onClick={onOpenSettings}>
            Configurar token
          </button>
        )}
      </div>
    </aside>
  );
});
