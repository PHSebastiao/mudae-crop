import { useEffect, useRef, useState, type RefObject } from 'react';
import { outputSize, type DocumentState, type ExportScale } from '../core/document';
import { exportKindFor } from '../core/export';
import { formatHistoryDate, type ExportEntry, type HistoryEntry } from '../core/history';
import type { HistoryPreviewLoader } from '../core/historyPreview';
import { isPostId } from '../core/imagechest';
import type { Settings } from '../core/settings';

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
  readonly onExport: () => void;
  readonly onExportScale: (scale: ExportScale) => void;
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
          {format} · {entry.width}×{entry.height}
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
  onExport,
  onExportScale,
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
  const format = exportKindFor(doc.source).label;
  const exportLabel = downloading
    ? 'Aguarde o link…'
    : busy && !uploading
      ? 'Exportando…'
      : `Exportar ${format} ${doc.exportScale}×`;
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
        <div className="meta">
          <span>{format}</span>
          <span>
            {doc.exportScale}× · {size.width}×{size.height}
          </span>
        </div>
        <div className="toggle" role="group" aria-label="Escala do Export">
          <button
            type="button"
            className={doc.exportScale === 1 ? 'on' : ''}
            onClick={() => onExportScale(1)}
          >
            1×
          </button>
          <button
            type="button"
            className={doc.exportScale === 2 ? 'on' : ''}
            onClick={() => onExportScale(2)}
          >
            2×
          </button>
        </div>
        <div className="meta">
          <span>tamanho</span>
          <span>—</span>
        </div>
        <button
          type="button"
          className="big primary"
          onClick={onExport}
          disabled={!doc.source || busy}
        >
          {exportLabel}
        </button>
        <p className="panel-hint">Ctrl+S exporta · salva na pasta escolhida</p>
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
                      {entry.format.toUpperCase()} · Post {entry.postId}
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
