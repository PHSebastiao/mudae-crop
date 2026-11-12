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
import { ToggleGroup, type ToggleOption } from './ToggleGroup';

/** The tooltip's fixed width, shared by its placement and its inline style. */
const TIP_WIDTH = 248;

/** The four Scale modes in one group; they are exclusive, so they share a
 *  single 2×2 toggle group instead of reading as two unrelated controls. */
const MODE_OPTIONS: ReadonlyArray<{ value: ScaleMode; label: string; title: string }> = [
  { value: 'fit', label: 'Fit', title: 'Cobre o Frame, cortando o excesso da Source' },
  { value: 'pad', label: 'Pad', title: 'Cabe inteira, preenchendo as sobras com o Pad color' },
  { value: 'full-width', label: 'Largura', title: 'Encaixa a largura da Source no Frame' },
  { value: 'full-height', label: 'Altura', title: 'Encaixa a altura da Source no Frame' },
];

/** What the selected Scale mode does, in one line under the toggles. */
const MODE_HINTS: Record<ScaleMode, string> = {
  fit: 'Cobre e corta o excesso.',
  pad: 'Mostra a Source inteira.',
  'full-width': 'Encaixa pela largura.',
  'full-height': 'Encaixa pela altura.',
};

/** The sidecar's own denoise levels, 0 (least) to 3 (most). */
const DENOISE_OPTIONS: ReadonlyArray<ToggleOption<Waifu2xSettings['denoise']>> = (
  [0, 1, 2, 3] as const
).map((level) => ({ value: level, label: String(level), title: `Denoise ${level}` }));

const WAIFU2X_SCALE_OPTIONS: ReadonlyArray<ToggleOption<Waifu2xSettings['scale']>> = (
  [1, 2, 4] as const
).map((scale) => ({
  value: scale,
  label: `${scale}×`,
  title:
    scale === 1 ? 'Mantém o tamanho do Export' : `Amplia ${scale}× e define o tamanho do Export`,
}));

const SPEED_OPTIONS: ReadonlyArray<ToggleOption<number>> = [0.5, 1, 2].map((speed) => ({
  value: speed,
  label: `${speed.toString().replace('.', ',')}×`,
}));

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
    return null;
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
            <svg viewBox="77.5 97.5 442 409" aria-hidden="true" focusable="false">
              <g
                fill="none"
                stroke="currentColor"
                strokeWidth="38"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="178,122.5 178,404.5 494.5,404.5" />
                <polyline points="422,481.5 422,195.5 102.5,195.5" />
              </g>
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
        <ToggleGroup
          className="mode-toggle"
          label="Escala"
          value={mode}
          onChange={onMode}
          options={MODE_OPTIONS}
          columns={2}
        />
        <p className="rail-hint mode-hint">{MODE_HINTS[mode]}</p>
        <RailDisclosure label="Ajuste do Crop">
          <div className="row">
            <span className="key">zoom</span>
            <span className="field">
              <NumberField value={zoom} onCommit={onZoom} label="Zoom" precision={2} />
              <span className="unit">×</span>
            </span>
          </div>
          <div className="row">
            <span className="key">deslocamento H</span>
            <span className="field">
              <NumberField
                value={offsetX}
                onCommit={(next) => onOffset(next, offset.y * 100)}
                label="Offset horizontal"
                precision={1}
                step={0.5}
              />
              <span className="unit">%</span>
            </span>
          </div>
          <div className="row">
            <span className="key">deslocamento V</span>
            <span className="field">
              <NumberField
                value={offsetY}
                onCommit={(next) => onOffset(offset.x * 100, next)}
                label="Offset vertical"
                precision={1}
                step={0.5}
              />
              <span className="unit">%</span>
            </span>
          </div>
          <div className="row">
            <span className="key">girar</span>
            <button type="button" className="pill" onClick={onRotate}>
              {doc.crop.rotation}° ↻
            </button>
          </div>
          <div className="row">
            <span className="key">cor do Pad</span>
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
          <span className="key">nitidez</span>
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
            <ToggleGroup
              label="Denoise do waifu2x"
              value={waifu2x.denoise}
              onChange={(denoise) => onWaifu2x({ denoise })}
              disabled={waifu2xControlsDisabled}
              options={DENOISE_OPTIONS}
            />
            <ToggleGroup
              label="Escala do waifu2x"
              value={waifu2x.scale}
              onChange={(scale) => onWaifu2x({ scale })}
              disabled={waifu2xControlsDisabled}
              options={WAIFU2X_SCALE_OPTIONS}
            />
          </RailDisclosure>
          <p className="panel-hint">{waifu2xHint}</p>
        </div>
      </div>

      {animated && (
        <div className="group">
          <div className="label">GIF</div>
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
            <span className="key">trecho</span>
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
            <ToggleGroup
              label="Velocidade do GIF"
              value={doc.speed}
              onChange={onSpeed}
              options={SPEED_OPTIONS}
            />
            <button type="button" className="link" onClick={() => onTrim(null)}>
              redefinir trecho
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
        </div>
      )}
    </aside>
  );
});
