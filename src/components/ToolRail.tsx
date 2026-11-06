import type { DocumentState } from '../core/document';

interface ToolRailProps {
  readonly doc: DocumentState;
  readonly onResetCrop: () => void;
}

export function ToolRail({ doc, onResetCrop }: ToolRailProps) {
  return (
    <aside className="rail">
      <div className="group">
        <div className="label">Crop</div>
        <div className="toggle" role="group" aria-label="Modo de escala">
          <span className="on">Fit</span>
          <span className="disabled" title="Pad chega numa próxima etapa">
            Pad
          </span>
        </div>
        <div className="row">
          <span className="key">zoom</span>
          <span className="pill">{doc.crop.zoom.toFixed(2)}×</span>
        </div>
        <div className="row">
          <span className="key">offset</span>
          <span className="pill">
            {Math.round(doc.crop.offsetX)}, {Math.round(doc.crop.offsetY)}
          </span>
        </div>
        <div className="row">
          <span className="key">rotate</span>
          <span className="pill disabled" title="Rotação chega numa próxima etapa">
            0°
          </span>
        </div>
        <button type="button" className="link" onClick={onResetCrop} disabled={!doc.source}>
          redefinir Crop
        </button>
      </div>

      <div className="group disabled-group">
        <div className="label">Borda</div>
        <div className="row">
          <span className="key">width</span>
          <span className="pill">1 px</span>
        </div>
      </div>

      <div className="group disabled-group">
        <div className="label">GIF</div>
        <div className="row">
          <span className="key">trim</span>
          <span>—</span>
        </div>
        <div className="row">
          <span className="key">frames</span>
          <span>—</span>
        </div>
      </div>
    </aside>
  );
}
