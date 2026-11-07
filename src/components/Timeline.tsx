import type { Trim } from '../core/document';
import { formatDuration } from '../core/animation';

interface TimelineProps {
  readonly frameIndex: number;
  readonly trim: Trim;
  readonly totalFrames: number;
  readonly durationMs: number;
  readonly playing: boolean;
  readonly disabled: boolean;
  readonly onScrub: (frameIndex: number) => void;
  readonly onTogglePlay: () => void;
}

/**
 * Playback controls for an animated Source. The scrubber only spans the active
 * Trim, so the frame it lands on is always part of the Export.
 */
export function Timeline({
  frameIndex,
  trim,
  totalFrames,
  durationMs,
  playing,
  disabled,
  onScrub,
  onTogglePlay,
}: TimelineProps) {
  const position = Math.min(trim.end, Math.max(trim.start, frameIndex));
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
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="slider timeline-range"
        type="range"
        min={trim.start}
        max={trim.end}
        step={1}
        value={position}
        onChange={(event) => onScrub(Number(event.target.value))}
        aria-label="Quadro atual"
        disabled={disabled}
      />
      <span className="timeline-meta">
        quadro {position + 1}/{totalFrames} · {formatDuration(durationMs)}
      </span>
    </div>
  );
}
