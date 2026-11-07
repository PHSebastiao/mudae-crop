import {
  MAX_SHARPNESS,
  animationFrameCount,
  clampTrim,
  isAnimated,
  trimFrameCount,
  type DocumentState,
  type ScaleMode,
  type Trim,
} from '../core/document';
import { formatDuration, trimDurationMs } from '../core/animation';
import { HexInput } from './HexInput';
import { NumberField } from './NumberField';

interface ToolRailProps {
  readonly doc: DocumentState;
  readonly onMode: (mode: ScaleMode) => void;
  readonly onZoom: (zoom: number) => void;
  readonly onOffset: (offsetX: number, offsetY: number) => void;
  readonly onPadColor: (color: string) => void;
  readonly onRotate: () => void;
  readonly onResetCrop: () => void;
  readonly onSharpness: (sharpness: number) => void;
  readonly onPickPadColor: () => void;
  readonly onTrim: (trim: Trim | null) => void;
  readonly pickingPad: boolean;
}

export function ToolRail({
  doc,
  onMode,
  onZoom,
  onOffset,
  onPadColor,
  onRotate,
  onResetCrop,
  onSharpness,
  onPickPadColor,
  onTrim,
  pickingPad,
}: ToolRailProps) {
  const hasSource = doc.source !== null;
  const mode = doc.crop.mode;
  const animated = isAnimated(doc.source);
  const frames = animationFrameCount(doc.source);
  const last = Math.max(0, frames - 1);
  const trim = clampTrim(doc.source, doc.trim) ?? { start: 0, end: 0 };
  const trimmed = trimFrameCount(doc.source, doc.trim);
  const setStart = (start: number) => onTrim({ start, end: Math.max(start, trim.end) });
  const setEnd = (end: number) => onTrim({ start: Math.min(trim.start, end), end });

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
              title="Para pegar uma cor da imagem, use “pegar cor da imagem”"
              disabled={!hasSource}
            />
            <HexInput
              className="rail-hex"
              value={doc.padColor}
              onCommit={onPadColor}
              label="HEX do Pad"
              disabled={!hasSource}
            />
          </span>
        </div>
        <button
          type="button"
          className="link rail-pick"
          onClick={onPickPadColor}
          disabled={!hasSource}
          aria-pressed={pickingPad}
        >
          {pickingPad ? 'clique na imagem · Esc cancela' : 'pegar cor da imagem'}
        </button>
        <button type="button" className="link" onClick={onResetCrop} disabled={!hasSource}>
          redefinir Crop
        </button>
      </div>

      <div className="group">
        <div className="label">Nitidez</div>
        <div className="row">
          <span className="key">sharpness</span>
          <span className="pill">{doc.sharpness}</span>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={MAX_SHARPNESS}
          step={1}
          value={doc.sharpness}
          onChange={(event) => onSharpness(Number(event.target.value))}
          aria-label="Nitidez"
          disabled={!hasSource}
        />
        <p className="rail-hint">unsharp mask · 0 desliga</p>
      </div>

      <div className={animated ? 'group' : 'group disabled-group'}>
        <div className="label">GIF</div>
        <div className="row">
          <span className="key">quadros</span>
          <span>
            {animated ? `${trimmed} de ${frames}` : '—'}
          </span>
        </div>
        <div className="row">
          <span className="key">duração</span>
          <span>{animated ? formatDuration(trimDurationMs(doc.source, doc.trim)) : '—'}</span>
        </div>
        <div className="row">
          <span className="key">trim</span>
          <span>{animated ? `${trim.start + 1}–${trim.end + 1}` : '—'}</span>
        </div>
        <input
          className="slider"
          type="range"
          min={0}
          max={last}
          step={1}
          value={trim.start}
          onChange={(event) => setStart(Number(event.target.value))}
          aria-label="Primeiro quadro do trim"
          disabled={!animated}
        />
        <input
          className="slider"
          type="range"
          min={0}
          max={last}
          step={1}
          value={trim.end}
          onChange={(event) => setEnd(Number(event.target.value))}
          aria-label="Último quadro do trim"
          disabled={!animated}
        />
        <button
          type="button"
          className="link"
          onClick={() => onTrim(null)}
          disabled={!animated}
        >
          redefinir trim
        </button>
      </div>
    </aside>
  );
}
