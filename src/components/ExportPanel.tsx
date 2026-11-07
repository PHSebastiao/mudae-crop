import { outputSize, type DocumentState, type ExportScale } from '../core/document';
import { formatHistoryDate, type HistoryEntry } from '../core/history';
import { isPostId } from '../core/imagechest';
import type { Settings } from '../core/settings';

interface ExportPanelProps {
  readonly doc: DocumentState;
  readonly busy: boolean;
  readonly downloading: boolean;
  readonly uploading: boolean;
  readonly settings: Settings;
  readonly history: readonly HistoryEntry[];
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

export function ExportPanel({
  doc,
  busy,
  downloading,
  uploading,
  settings,
  history,
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
  const exportLabel = downloading
    ? 'Aguarde o link…'
    : busy && !uploading
      ? 'Exportando…'
      : `Exportar PNG ${doc.exportScale}×`;

  return (
    <aside className="panel">
      <section>
        <h4>Export</h4>
        <div className="meta">
          <span>PNG</span>
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
          <ul className="history">
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
                <li key={`export-${entry.path}-${entry.createdAt}`}>
                  <span className="history-file">{entry.format.toUpperCase()}</span>
                  <div className="history-body">
                    <span className="history-link" title={entry.path}>
                      {entry.fileName}
                    </span>
                    <span className="history-meta" title={entry.path}>
                      {entry.path}
                    </span>
                    <span className="history-meta">
                      {entry.format.toUpperCase()} · {entry.width}×{entry.height}
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
              ),
            )}
          </ul>
        )}
      </section>

      <section className="divided disabled-group">
        <h4>Borda</h4>
        <div className="border-preview">
          <div
            className="border-pixel"
            style={{ borderColor: settings.borderColor, borderWidth: settings.borderWidth }}
          />
          <div className="caption">prévia da Borda na próxima etapa</div>
        </div>
      </section>
    </aside>
  );
}
