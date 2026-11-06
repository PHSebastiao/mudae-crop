import type { DocumentState, ScaleMode } from '../core/document';
import { NumberField } from './NumberField';

interface ToolRailProps {
  readonly doc: DocumentState;
  readonly onMode: (mode: ScaleMode) => void;
  readonly onZoom: (zoom: number) => void;
  readonly onOffset: (offsetX: number, offsetY: number) => void;
  readonly onPadColor: (color: string) => void;
  readonly onRotate: () => void;
  readonly onResetCrop: () => void;
}

export function ToolRail({
  doc,
  onMode,
  onZoom,
  onOffset,
  onPadColor,
  onRotate,
  onResetCrop,
}: ToolRailProps) {
  const hasSource = doc.source !== null;
  const mode = doc.crop.mode;

  return (
    <aside className="rail">
      <div className="group">
        <div className="label">Crop</div>
        <div className="toggle" role="group" aria-label="Modo de escala">
          <button
            type="button"
            className={mode === 'fit' ? 'on' : ''}
            onClick={() => onMode('fit')}
            title="Cobre o Frame, cortando o excesso"
          >
            Fit
          </button>
          <button
            type="button"
            className={mode === 'pad' ? 'on' : ''}
            onClick={() => onMode('pad')}
            title="Cabe inteira, preenchendo as sobras"
          >
            Pad
          </button>
        </div>
        <div className="toggle" role="group" aria-label="Encaixe no eixo">
          <button
            type="button"
            className={mode === 'full-width' ? 'on' : ''}
            onClick={() => onMode('full-width')}
            title="Encaixa a largura da Source no Frame"
          >
            largura
          </button>
          <button
            type="button"
            className={mode === 'full-height' ? 'on' : ''}
            onClick={() => onMode('full-height')}
            title="Encaixa a altura da Source no Frame"
          >
            altura
          </button>
        </div>
        <div className="row">
          <span className="key">zoom</span>
          <span className="field">
            <NumberField
              value={doc.crop.zoom}
              onCommit={onZoom}
              label="Zoom"
              precision={2}
              disabled={!hasSource}
            />
            <span className="unit">×</span>
          </span>
        </div>
        <div className="row">
          <span className="key">offset x</span>
          <NumberField
            value={doc.crop.offsetX}
            onCommit={(offsetX) => onOffset(offsetX, doc.crop.offsetY)}
            label="Offset horizontal"
            disabled={!hasSource}
          />
        </div>
        <div className="row">
          <span className="key">offset y</span>
          <NumberField
            value={doc.crop.offsetY}
            onCommit={(offsetY) => onOffset(doc.crop.offsetX, offsetY)}
            label="Offset vertical"
            disabled={!hasSource}
          />
        </div>
        <div className="row">
          <span className="key">rotate</span>
          <button type="button" className="pill" onClick={onRotate} disabled={!hasSource}>
            {doc.crop.rotation}° ↻
          </button>
        </div>
        <div className="row">
          <span className="key">pad</span>
          <span className="field">
            <input
              className="color"
              type="color"
              value={doc.padColor}
              onChange={(event) => onPadColor(event.target.value)}
              aria-label="Cor do Pad"
              disabled={!hasSource}
            />
            <code>{doc.padColor.toUpperCase()}</code>
          </span>
        </div>
        <button type="button" className="link" onClick={onResetCrop} disabled={!hasSource}>
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
