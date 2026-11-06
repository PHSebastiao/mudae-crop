import { outputSize, type DocumentState, type ExportScale } from '../core/document';

interface ExportPanelProps {
  readonly doc: DocumentState;
  readonly busy: boolean;
  readonly downloading: boolean;
  readonly onExport: () => void;
  readonly onExportScale: (scale: ExportScale) => void;
}

export function ExportPanel({
  doc,
  busy,
  downloading,
  onExport,
  onExportScale,
}: ExportPanelProps) {
  const size = outputSize(doc);
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
        <button type="button" className="big primary" onClick={onExport} disabled={!doc.source || busy}>
          {busy ? (downloading ? 'Aguarde o link…' : 'Exportando…') : `Exportar PNG ${doc.exportScale}×`}
        </button>
        <p className="panel-hint">Ctrl+S exporta · salva na pasta escolhida</p>
      </section>

      <section className="divided disabled-group">
        <h4>Image Chest</h4>
        <div className="meta">
          <span>post</span>
          <span>hidden</span>
        </div>
        <button type="button" className="big" disabled title="Upload chega numa próxima etapa">
          Subir e copiar link
        </button>
      </section>

      <section className="divided disabled-group">
        <h4>Borda</h4>
        <div className="border-preview">
          <div className="border-pixel" />
          <div className="caption">prévia da Borda na próxima etapa</div>
        </div>
      </section>
    </aside>
  );
}
