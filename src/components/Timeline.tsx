import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { Trim } from '../core/document';
import { formatPlaybackDuration } from '../core/animation';

interface TimelineProps {
  readonly frameIndex: number;
  readonly frameCount: number;
  readonly trim: Trim;
  readonly trimEnabled: boolean;
  readonly durationMs: number;
  readonly playing: boolean;
  readonly disabled: boolean;
  readonly onScrub: (frameIndex: number) => void;
  readonly onTogglePlay: () => void;
  readonly onTrimEnabled: (enabled: boolean) => void;
  readonly onTrimChange: (trim: Trim) => void;
}

type DragTarget = 'start' | 'end' | 'playhead';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * One track for playback and Trim. With trim off only the playhead moves; with
 * trim on the two red handles define the range and the playhead stays inside.
 */
export function Timeline({
  frameIndex,
  frameCount,
  trim,
  trimEnabled,
  durationMs,
  playing,
  disabled,
  onScrub,
  onTogglePlay,
  onTrimEnabled,
  onTrimChange,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragTarget | null>(null);
  const last = Math.max(0, frameCount - 1);

  const percent = (value: number) => (last <= 0 ? 0 : (clamp(value, 0, last) / last) * 100);

  const frameAt = (clientX: number): number | null => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round(ratio * last);
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, target: DragTarget) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = target;
  };

  const handleTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const frame = frameAt(event.clientX);
    if (frame === null) return;

    if (trimEnabled) {
      const pointer = percent(frame);
      const choices: Array<{ target: DragTarget; distance: number }> = [
        { target: 'start', distance: Math.abs(pointer - percent(trim.start)) },
        { target: 'end', distance: Math.abs(pointer - percent(trim.end)) },
        { target: 'playhead', distance: Math.abs(pointer - percent(frameIndex)) },
      ];
      choices.sort((a, b) => a.distance - b.distance);

      const closest = choices[0];
      if (closest.distance <= 3) {
        beginDrag(event, closest.target);
        return;
      }
    }

    beginDrag(event, 'playhead');
    onScrub(clamp(frame, trim.start, trim.end));
  };

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    const target = dragRef.current;
    if (!target || disabled) return;
    const frame = frameAt(event.clientX);
    if (frame === null) return;

    if (target === 'start') {
      onTrimChange({
        start: Math.min(frame, trim.end),
        end: Math.max(frame, trim.end),
      });
      return;
    }
    if (target === 'end') {
      onTrimChange({
        start: Math.min(trim.start, frame),
        end: Math.max(trim.start, frame),
      });
      return;
    }
    onScrub(clamp(frame, trim.start, trim.end));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const nudge = (target: 'start' | 'end', delta: number) => {
    if (target === 'start') {
      const start = clamp(trim.start + delta, 0, trim.end);
      onTrimChange({ start, end: Math.max(start, trim.end) });
    } else {
      const end = clamp(trim.end + delta, trim.start, last);
      onTrimChange({ start: Math.min(trim.start, end), end });
    }
  };

  const onHandleKey = (event: KeyboardEvent<HTMLButtonElement>, target: 'start' | 'end') => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      nudge(target, event.key === 'ArrowLeft' ? -step : step);
    }
  };

  const selectionLeft = percent(trim.start);
  const selectionWidth = Math.max(0, percent(trim.end) - selectionLeft);
  const playhead = percent(frameIndex);

  return (
    <div className="timeline" aria-label="Reprodução do GIF">
      <button
        type="button"
        className="timeline-play"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        title={playing ? 'Pausar (espaço)' : 'Reproduzir (espaço)'}
      >
        {playing ? (
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
            <rect x="3" y="2.5" width="2.2" height="7" rx="1.1" />
            <rect x="6.8" y="2.5" width="2.2" height="7" rx="1.1" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
            {/* Sits a hair right of centre: a triangle's mass is on its base. */}
            <path
              d="M3.7 3.1 8.9 6 3.7 8.9Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className={`timeline-trim${trimEnabled ? ' on' : ''}`}
        onClick={() => onTrimEnabled(!trimEnabled)}
        disabled={disabled}
        aria-pressed={trimEnabled}
        title="Escolher só um trecho do GIF"
      >
        trecho
      </button>

      <div
        ref={trackRef}
        className={`timeline-track${trimEnabled ? ' trimming' : ''}`}
        onPointerDown={handleTrackDown}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {trimEnabled && (
          <span
            className="timeline-selection"
            style={{ left: `${selectionLeft}%`, width: `${selectionWidth}%` }}
          />
        )}
        <span className="timeline-playhead" style={{ left: `${playhead}%` }} />
        {trimEnabled && (
          <>
            <button
              type="button"
              className="timeline-handle start"
              style={{ left: `${selectionLeft}%` }}
              onPointerDown={(event) => beginDrag(event, 'start')}
              onKeyDown={(event) => onHandleKey(event, 'start')}
              aria-label="Primeiro quadro do trecho"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={trim.end}
              aria-valuenow={trim.start}
            />
            <button
              type="button"
              className="timeline-handle end"
              style={{ left: `${percent(trim.end)}%` }}
              onPointerDown={(event) => beginDrag(event, 'end')}
              onKeyDown={(event) => onHandleKey(event, 'end')}
              aria-label="Último quadro do trecho"
              role="slider"
              aria-valuemin={trim.start}
              aria-valuemax={last}
              aria-valuenow={trim.end}
            />
          </>
        )}
      </div>

      <span className="timeline-meta">
        quadro {Math.min(last, Math.max(0, frameIndex)) + 1}/{frameCount} ·{' '}
        {formatPlaybackDuration(durationMs)}
      </span>
    </div>
  );
}
