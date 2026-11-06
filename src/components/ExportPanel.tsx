import type { DocumentState } from '../core/document';

interface ExportPanelProps {
  readonly doc: DocumentState;
  readonly busy: boolean;
  readonly onExport: () => void;
}

export function ExportPanel({ doc, busy, onExport }: ExportPanelProps) {
  const size = `${doc.frame.width}×${doc.frame.height}`;
  return (
    <aside className="panel">
      <section>
        <h4>Export</h4>
        <div className="meta">
          <span>PNG</span>
          <span>1× · {size}</span>
        </div>
        <div className="toggle" role="group" aria-label="Escala do Export">
          <span className="on">1×</span>
          <span className="disabled" title="2× chega numa próxima etapa">
            2×
          </span>
        </div>
        <div className="meta">
          <span>tamanho</span>
          <span>—</span>
        </div>
        <button type="button" className="big primary" onClick={onExport} disabled={!doc.source || busy}>
          {busy ? 'Exportando…' : 'Exportar PNG'}
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
          <div className="caption">1 px dentro do Frame</div>
        </div>
      </section>
    </aside>
  );
}
