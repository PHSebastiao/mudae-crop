import { memo, useState, type ReactNode } from 'react';
import {
  MAX_SHARPNESS,
  MAX_SPEED,
  MIN_SPEED,
  animationFrameCount,
  effectiveAnimation,
  effectiveSource,
  effectiveTrim,
  isAnimated,
  trimFrameCount,
  type DocumentState,
  type ScaleMode,
  type Trim,
  type Waifu2xSettings,
  type Waifu2xStatus,
} from '../core/document';
import { formatPlaybackDuration, trimDurationMs } from '../core/animation';
import { offsetPct, zoomOf } from '../core/geometry';
import { HexInput } from './HexInput';
import { NumberField } from './NumberField';

/** The tooltip's fixed width, shared by its placement and its inline style. */
const TIP_WIDTH = 248;

interface ToolRailProps {
  readonly doc: DocumentState;
  readonly onMode: (mode: ScaleMode) => void;
  readonly onZoom: (zoom: number) => void;
  readonly onOffset: (offsetX: number, offsetY: number) => void;
  readonly onPadColor: (color: string) => void;
  readonly onRotate: () => void;
  readonly onResetCrop: () => void;
  readonly onSharpness: (sharpness: number) => void;
  readonly waifu2x: Waifu2xSettings;
  readonly waifu2xStatus: Waifu2xStatus | 'checking';
  readonly waifu2xDetail: string | null;
  readonly onWaifu2x: (patch: Partial<Waifu2xSettings>) => void;
  readonly onPickPadColor: () => void;
  readonly onTrim: (trim: Trim | null) => void;
  readonly onSpeed: (speed: number) => void;
  readonly pickingPad: boolean;
  readonly framesOpen: boolean;
  readonly onToggleFrames: () => void;
  readonly adjustFrame: boolean;
  readonly onToggleAdjustFrame: () => void;
}

/** A native disclosure, so the folded controls stay keyboard-accessible. */
function RailDisclosure({
  label,
  open,
  children,
}: {
  readonly label: string;
  readonly open?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <details className="rail-disclosure" open={open}>
      <summary>
        <span>{label}</span>
        <span className="rail-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path
              d="M6.25 3.5 10.75 8l-4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className="rail-disclosure-body">{children}</div>
    </details>
  );
}

export const ToolRail = memo(function ToolRail({
  doc,
  onMode,
  onZoom,
  onOffset,
  onPadColor,
  onRotate,
  onResetCrop,
  onSharpness,
  waifu2x,
  waifu2xStatus,
  waifu2xDetail,
  onWaifu2x,
  onPickPadColor,
  onTrim,
  onSpeed,
  pickingPad,
  framesOpen,
  onToggleFrames,
  adjustFrame,
  onToggleAdjustFrame,
}: ToolRailProps) {
  const hasSource = doc.source !== null;
  const mode = doc.crop.mode;
  const animated = isAnimated(effectiveSource(doc));
  const imageAnimation = effectiveAnimation(doc) !== null;
  const frames = animationFrameCount(effectiveSource(doc));
  const trim = effectiveTrim(doc) ?? { start: 0, end: 0 };
  const trimmed = trimFrameCount(effectiveSource(doc), effectiveTrim(doc));
  const speedLabel = `${doc.speed.toFixed(2).replace('.', ',')}×`;
  const zoom = zoomOf(doc);
  const offset = offsetPct(doc);
  const offsetX = Math.round(offset.x * 1000) / 10;
  const offsetY = Math.round(offset.y * 1000) / 10;
  const waifu2xReady = waifu2xStatus === 'ready';
  const waifu2xDisabled = !hasSource || !waifu2xReady;
  const waifu2xControlsDisabled = waifu2xDisabled || !waifu2x.enabled;
  // An enabled-but-unavailable block stays interactive so its off switch
  // always works; only an unavailable block that is already off dims.
  const waifu2xBlockDisabled = !hasSource || (!waifu2xReady && !waifu2x.enabled);
  const waifu2xHint =
    waifu2xStatus === 'checking'
      ? 'verificando a GPU e o sidecar…'
      : waifu2xStatus === 'ready'
        ? waifu2x.enabled
          ? 'aplicado no Export'
          : 'ligue para aplicar no Export'
        : (waifu2xDetail ?? 'waifu2x indisponível neste computador');

  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);
  const showTip = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setTip({
      left: Math.max(12, Math.min(window.innerWidth - TIP_WIDTH - 12, rect.right + 10)),
      top: rect.top + rect.height / 2,
    });
  };

  if (!hasSource) {
    return (
      <aside className="rail rail-steps" aria-label="Passos para começar">
        <div className="rail-step active" aria-current="step">
          <b>1</b>
          <span>Source</span>
          <small>abrir · arrastar · colar</small>
        </div>
        <div className="rail-step">
          <b>2</b>
          <span>Frame</span>
          <small>proporção no topo</small>
        </div>
        <div className="rail-step">
          <b>3</b>
          <span>Borda</span>
          <small>cor e largura</small>
        </div>
        <div className="rail-step">
          <b>4</b>
          <span>Export</span>
          <small>PNG ou GIF</small>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rail">
      <div className="group">
        <div className="label">Frame</div>
        <div
          className="rail-adjust-row"
          onMouseEnter={(event) => showTip(event.currentTarget)}
          onMouseLeave={() => setTip(null)}
        >
          <button
            type="button"
            className={`rail-adjust${adjustFrame ? ' on' : ''}`}
            onClick={onToggleAdjustFrame}
            onFocus={(event) => showTip(event.currentTarget)}
            onBlur={() => setTip(null)}
            aria-pressed={adjustFrame}
            aria-keyshortcuts="C"
            aria-describedby={tip ? 'frame-adjust-tip' : undefined}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M3.5 1v11.5H15M1 3.5h11.5V15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span>{adjustFrame ? 'Concluir' : 'Ajustar Frame'}</span>
            <span className="rail-adjust-key">C</span>
          </button>
          {tip && (
            <span
              className="rail-tip"
              id="frame-adjust-tip"
              role="tooltip"
              style={{ left: tip.left, top: tip.top, width: TIP_WIDTH }}
            >
              <strong>Ajustar Frame</strong>
              Arraste as bordas ou os cantos do Frame para enquadrar. Shift solta a proporção; +Alt
              solta os encaixes (proporção e centro); a roda do mouse dá zoom. C ou Esc conclui.
            </span>
          )}
        </div>
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
        <RailDisclosure label="Ajuste fino">
          <div className="row">
            <span className="key">zoom</span>
            <span className="field">
              <NumberField value={zoom} onCommit={onZoom} label="Zoom" precision={2} />
              <span className="unit">×</span>
            </span>
          </div>
          <div className="row">
            <span className="key">offset x</span>
            <span className="field">
              <NumberField
                value={offsetX}
                onCommit={(next) => onOffset(next, offset.y * 100)}
                label="Offset horizontal"
                precision={1}
              />
              <span className="unit">%</span>
            </span>
          </div>
          <div className="row">
            <span className="key">offset y</span>
            <span className="field">
              <NumberField
                value={offsetY}
                onCommit={(next) => onOffset(offset.x * 100, next)}
                label="Offset vertical"
                precision={1}
              />
              <span className="unit">%</span>
            </span>
          </div>
          <div className="row">
            <span className="key">rotate</span>
            <button type="button" className="pill" onClick={onRotate}>
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
              />
              <HexInput
                className="rail-hex"
                value={doc.padColor}
                onCommit={onPadColor}
                label="HEX do Pad"
              />
            </span>
          </div>
          <button
            type="button"
            className="link rail-pick"
            onClick={onPickPadColor}
            aria-pressed={pickingPad}
          >
            {pickingPad ? 'clique na imagem · Esc cancela' : 'pegar cor da imagem'}
          </button>
          <button type="button" className="link" onClick={onResetCrop}>
            redefinir Crop
          </button>
        </RailDisclosure>
      </div>

      <div className="group">
        <div className="label">Realce</div>
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
        />
        <div className={waifu2xBlockDisabled ? 'waifu2x-block disabled-group' : 'waifu2x-block'}>
          <div className="row">
            <span className="key">waifu2x</span>
            <button
              type="button"
              className={`toggle-pill${waifu2x.enabled ? ' on' : ''}`}
              onClick={() => onWaifu2x({ enabled: !waifu2x.enabled })}
              aria-pressed={waifu2x.enabled}
              disabled={!waifu2xReady && !waifu2x.enabled}
              title={waifu2x.enabled ? 'Desligar o waifu2x' : 'Ligar o waifu2x'}
            >
              {waifu2x.enabled ? 'ligado' : 'desligado'}
            </button>
          </div>
          <RailDisclosure label="Denoise e escala">
            <div className="row">
              <span className="key">denoise</span>
              <span className="pill">{waifu2x.denoise}</span>
            </div>
            <div className="toggle" role="group" aria-label="Denoise do waifu2x">
              {[0, 1, 2, 3].map((level) => (
                <button
                  key={level}
                  type="button"
                  className={waifu2x.denoise === level ? 'on' : ''}
                  onClick={() => onWaifu2x({ denoise: level as Waifu2xSettings['denoise'] })}
                  aria-pressed={waifu2x.denoise === level}
                  disabled={waifu2xControlsDisabled}
                  title={`Denoise ${level}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <div className="toggle" role="group" aria-label="Escala do waifu2x">
              {[1, 2, 4].map((scale) => (
                <button
                  key={scale}
                  type="button"
                  className={waifu2x.scale === scale ? 'on' : ''}
                  onClick={() => onWaifu2x({ scale: scale as Waifu2xSettings['scale'] })}
                  aria-pressed={waifu2x.scale === scale}
                  disabled={waifu2xControlsDisabled}
                  title={
                    scale === 1
                      ? 'Mantém o tamanho do Export'
                      : `Amplia ${scale}× e define o tamanho do Export`
                  }
                >
                  {scale}×
                </button>
              ))}
            </div>
          </RailDisclosure>
          <p className="panel-hint">{waifu2xHint}</p>
        </div>
      </div>

      <div className="group">
        <div className="label">GIF</div>
        {animated ? (
          <>
            <div className="row">
              <span className="key">quadros</span>
              <span>{`${trimmed} de ${frames}`}</span>
            </div>
            <div className="row">
              <span className="key">duração</span>
              <span>
                {formatPlaybackDuration(
                  trimDurationMs(effectiveSource(doc), effectiveTrim(doc), doc.speed),
                )}
              </span>
            </div>
            <div className="row">
              <span className="key">trim</span>
              <span>{`${trim.start + 1}–${trim.end + 1} · ${doc.trimEnabled ? 'on' : 'off'}`}</span>
            </div>
            <div className="row">
              <span className="key">velocidade</span>
              <span className="pill">{speedLabel}</span>
            </div>
            <RailDisclosure label="Ajustes do GIF">
              <input
                className="slider"
                type="range"
                min={MIN_SPEED}
                max={MAX_SPEED}
                step={0.05}
                value={doc.speed}
                onChange={(event) => onSpeed(Number(event.target.value))}
                aria-label="Velocidade do GIF"
              />
              <div className="toggle" role="group" aria-label="Velocidade do GIF">
                {[0.5, 1, 2].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className={Math.abs(doc.speed - speed) < 0.001 ? 'on' : ''}
                    onClick={() => onSpeed(speed)}
                  >
                    {speed.toString().replace('.', ',')}×
                  </button>
                ))}
              </div>
              <button type="button" className="link" onClick={() => onTrim(null)}>
                redefinir trim
              </button>
              {imageAnimation && (
                <button
                  type="button"
                  className={`link rail-frames${framesOpen ? ' on' : ''}`}
                  onClick={onToggleFrames}
                  aria-pressed={framesOpen}
                  aria-keyshortcuts="F"
                  title="Mostrar ou ocultar o painel de quadros (F)"
                >
                  {framesOpen ? 'ocultar painel de quadros' : 'ver painel de quadros'}
                </button>
              )}
            </RailDisclosure>
          </>
        ) : (
          <p className="panel-hint">Source estática · sem quadros</p>
        )}
      </div>
    </aside>
  );
});
