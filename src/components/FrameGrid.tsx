import { useEffect, useRef, type KeyboardEvent } from 'react';
import { MIN_FRAME_DELAY_MS, scaledDelayMs, type Animation } from '../core/document';
import { NumberField } from './NumberField';

/** Longest side of a thumbnail, in CSS pixels. */
const THUMB_SIZE = 54;

function formatSpeed(speed: number): string {
  return `${speed
    .toFixed(2)
    .replace(/\.?0+$/, '')
    .replace('.', ',')}×`;
}

interface FrameGridProps {
  readonly animation: Animation;
  readonly width: number;
  readonly height: number;
  readonly selectedIndex: number;
  readonly speed: number;
  readonly disabled: boolean;
  readonly onSelect: (index: number) => void;
  readonly onDelete: (index: number) => void;
  /** Receives the duration the frame plays at the current Speed. */
  readonly onRetime: (index: number, effectiveMs: number) => void;
}

function thumbSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { width: THUMB_SIZE, height: THUMB_SIZE };
  const scale = THUMB_SIZE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Draws one animation frame into a small canvas, at the Source's aspect. */
function FrameThumbnail({
  image,
  width,
  height,
}: {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [image, width, height]);

  return (
    <canvas
      className="frame-thumb"
      ref={canvasRef}
      width={width}
      height={height}
      aria-hidden="true"
    />
  );
}

/**
 * The grid of animation frames. Clicking a cell seeks the Preview; the
 * selected frame can be deleted or retimed. Every edit flows back into the
 * document, so the Preview, Trim and Export share one view of the animation.
 */
export function FrameGrid({
  animation,
  width,
  height,
  selectedIndex,
  speed,
  disabled,
  onSelect,
  onDelete,
  onRetime,
}: FrameGridProps) {
  const frames = animation.frames;
  const last = Math.max(0, frames.length - 1);
  const selected = Math.min(last, Math.max(0, selectedIndex));
  const thumb = thumbSize(width, height);
  const selectedFrame = frames[selected];
  const selectedDelay = selectedFrame
    ? scaledDelayMs(selectedFrame.delayMs, speed)
    : MIN_FRAME_DELAY_MS;
  const speedLabel = formatSpeed(speed);

  const onThumbKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      onSelect(Math.min(last, Math.max(0, index + step)));
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (frames.length <= 1) return;
      event.preventDefault();
      onSelect(index);
      onDelete(index);
    }
  };

  return (
    <section className="frame-grid" aria-label="Quadros da animação">
      <div className="frame-grid-bar">
        <span className="frame-grid-title">Quadros</span>
        <label
          className="frame-grid-delay"
          onFocusCapture={() => {
            if (!disabled) onSelect(selected);
          }}
        >
          <span>{speed === 1 ? 'duração do quadro' : `duração a ${speedLabel}`}</span>
          <NumberField
            value={selectedDelay}
            onCommit={(delayMs) => onRetime(selected, delayMs)}
            label="Duração do quadro selecionado em milissegundos"
            disabled={disabled || frames.length === 0}
          />
          <span className="unit">ms</span>
          {selectedFrame && selectedFrame.delayMs !== selectedDelay && (
            <span className="frame-grid-base">base {selectedFrame.delayMs} ms</span>
          )}
        </label>
        <button
          type="button"
          className="link frame-grid-remove"
          onClick={() => onDelete(selected)}
          disabled={disabled || frames.length <= 1}
          title="Remover o quadro selecionado"
        >
          remover quadro
        </button>
        <span className="frame-grid-count">
          quadro {selected + 1}/{frames.length}
        </span>
      </div>
      <div className="frame-grid-strip">
        {frames.map((frame, index) => {
          const delay = scaledDelayMs(frame.delayMs, speed);
          const base = frame.delayMs === delay ? '' : `, base ${frame.delayMs} ms`;
          return (
            <button
              key={index}
              type="button"
              className={`frame-cell${index === selected ? ' on' : ''}`}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => onThumbKey(event, index)}
              disabled={disabled}
              aria-pressed={index === selected}
              aria-label={`Quadro ${index + 1} de ${frames.length}, ${delay} ms${base}`}
              title={`Quadro ${index + 1} · ${delay} ms${base}`}
            >
              <FrameThumbnail image={frame.image} width={thumb.width} height={thumb.height} />
              <span className="frame-cell-meta">
                {index + 1} · {delay} ms
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
