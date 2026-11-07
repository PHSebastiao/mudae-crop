import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  MAX_COLORS,
  MAX_LOSSY,
  MIN_COLORS,
  MIN_LOSSY,
  isAnimated,
  outputSize,
  type DocumentState,
  type ExportScale,
  type OptimizeSettings,
} from '../core/document';
import { exportKindFor, type SizeEstimate } from '../core/export';
import { formatHistoryDate, type ExportEntry, type HistoryEntry } from '../core/history';
import type { HistoryPreviewLoader } from '../core/historyPreview';
import { isPostId } from '../core/imagechest';
import type { OptimizeResult } from '../core/optimize';
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
  readonly onExport: () => void;
  readonly onExportScale: (scale: ExportScale) => void;
  readonly onExportFormat: (format: 'png' | 'gif') => void;
  readonly onResizeWidth: (width: number) => void;
  readonly onResizeHeight: (height: number) => void;
  readonly onResizeLocked: (locked: boolean) => void;
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

export function ExportPanel({
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
  onExport,
  onExportScale,
  onExportFormat,
  onResizeWidth,
  onResizeHeight,
  onResizeLocked,
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
  const postId = appendPostId.trim();
  const badPostId = postId !== '' && !isPostId(postId);
  const hasToken = settings.token.trim() !== '';
  const cooling = cooldownSeconds > 0;
  const uploadDisabled = !doc.source || busy || cooling || badPostId || !hasToken;
  const kind = exportKindFor(doc.source, settings.exportFormat);
  const format = kind.label;
  const animated = isAnimated(doc.source);
  const custom = doc.resize !== null;
  const ratioMatches = aspectMatches(size, doc.frame);
  const ratioLabel = formatAspect(size);
  const sourceTooSmall = exceedsSource(size, doc.source);
  const exportLabel = downloading
    ? 'Aguarde o link…'
    : busy && !uploading
      ? 'Exportando…'
      : `Exportar ${format}`;
  const optimize = doc.optimize;
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
      <section>
        <h4>Export</h4>

        <div className="export-summary" aria-live="polite">
          <strong>
            {format} · {size.width}×{size.height}
          </strong>
          <span className={ratioMatches ? '' : 'warn'}>
            {ratioMatches ? 'proporção da carta' : 'esticada'}
          </span>
          {estimateLabel && <span title={estimateTitle}>{estimateLabel}</span>}
          {optimizeResult && <span>resultado {formatBytes(optimizeResult.size)}</span>}
        </div>

        {overGuidance && (
          <p className="panel-hint warn">
            {estimateLabel} passa dos {formatBytes(MUDAE_SIZE_GUIDANCE_BYTES)} recomendados
            pelo Mudae.
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
        {!animated && (
          <p className="panel-hint">GIF indisponível: a Source é estática.</p>
        )}

        <div className="export-sizes" role="radiogroup" aria-label="Tamanho do Export">
          <button
            type="button"
            className={`size-option${!custom && doc.exportScale === 1 ? ' on' : ''}`}
            onClick={() => onExportScale(1)}
            role="radio"
            aria-checked={!custom && doc.exportScale === 1}
          >
            <span>Carta 1×</span>
            <span className="dims">
              {doc.frame.width}×{doc.frame.height}
            </span>
          </button>
          <button
            type="button"
            className={`size-option${!custom && doc.exportScale === 2 ? ' on' : ''}`}
            onClick={() => onExportScale(2)}
            role="radio"
            aria-checked={!custom && doc.exportScale === 2}
            title="Renderiza a Source em 2×"
          >
            <span>Carta 2×</span>
            <span className="dims">
              {doc.frame.width * 2}×{doc.frame.height * 2}
            </span>
          </button>
          <button
            type="button"
            className={`size-option${custom ? ' on' : ''}`}
            onClick={() => {
              if (!custom) onResizeWidth(size.width);
            }}
            role="radio"
            aria-checked={custom}
          >
            <span>Personalizado</span>
            <span className="dims">—</span>
          </button>
        </div>

        {custom && (
          <div className="custom-size">
            <div className="custom-size-head">
              <NumberField
                value={size.width}
                onCommit={onResizeWidth}
                label="Largura do Export"
                disabled={!doc.source}
              />
              <button
                type="button"
                className={`lock${doc.resizeLocked ? ' on' : ''}`}
                onClick={() => onResizeLocked(!doc.resizeLocked)}
                disabled={!doc.source}
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
                value={size.height}
                onCommit={onResizeHeight}
                label="Altura do Export"
                disabled={!doc.source}
              />
            </div>
            <div className="custom-size-meta">
              <span className="ratio-chip">{ratioLabel}</span>
              <button
                type="button"
                className="link"
                onClick={() => onExportScale(doc.exportScale)}
              >
                voltar a {doc.exportScale}×
              </button>
            </div>
            {!doc.resizeLocked && !ratioMatches && (
              <p className="panel-hint bad">
                fora da proporção da carta — a imagem vai esticar
              </p>
            )}
          </div>
        )}

        {sourceTooSmall && doc.source && (
          <p className="panel-hint warn">
            acima da Source ({doc.source.width}×{doc.source.height}) — só amplia
          </p>
        )}

        {animated && kind.format === 'gif' && !custom && doc.exportScale === 2 && (
          <p className="panel-hint">
            2× renderiza a Source maior; o GIF pode passar de{' '}
            {formatBytes(MUDAE_SIZE_GUIDANCE_BYTES)}.
          </p>
        )}

        <button
          type="button"
          className="big primary"
          onClick={onExport}
          disabled={!doc.source || busy}
        >
          {exportLabel}
        </button>
        <p className="panel-hint">Ctrl+S exporta · salva na pasta escolhida</p>

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
                        onChange={(event) =>
                          onOptimize({ targetEnabled: event.target.checked })
                        }
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
                      aria-label="Compressão com perda"
                    />
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
                      {MIN_COLORS}–{MAX_COLORS} cores · perda até {MAX_LOSSY}
                    </p>
                  </>
                )}
              </>
            )}
            {optimizeResult && (
              <p
                className={`panel-hint${
                  optimizeResult.met === false ? ' bad' : ''
                }`}
              >
                {optimizeResult.met === null
                  ? 'compressão aplicada'
                  : optimizeResult.met
                    ? 'alvo atingido'
                    : 'alvo não atingido'}{' '}
                · {formatBytes(optimizeResult.size)} · perda {optimizeResult.lossy}
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
        <button
          type="button"
          className="big"
          onClick={onUpload}
          disabled={uploadDisabled}
          title={
            !hasToken
              ? 'Configure o token em Configurações'
              : badPostId
                ? 'Confira o Post id'
                : 'Cria um Post hidden e copia o link direto'
          }
        >
          {uploading
            ? 'Subindo…'
            : cooling
              ? `Aguarde ${cooldownSeconds}s`
              : 'Subir e copiar link'}
        </button>
        {!hasToken ? (
          <button type="button" className="link" onClick={onOpenSettings}>
            Configurar token
          </button>
        ) : (
          <p className="panel-hint">Ctrl+Enter sobe o Export e copia o link direto.</p>
        )}
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
    </aside>
  );
}
