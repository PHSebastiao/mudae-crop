import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flipRatio, matchesRatio, presetsFor, ratioLabel, ratioOrientation } from '../core/ratios';

import { formatAspect } from '../core/size';
import { ToggleGroup } from './ToggleGroup';

interface RatioMenuProps {
  readonly ratio: number;
  readonly sourceRatio: number | null;
  readonly snapEnabled: boolean;
  readonly onRatio: (ratio: number) => void;
  readonly onSnapEnabled: (enabled: boolean) => void;
  /** Lets the app suppress global shortcuts while the popover is open. */
  readonly onOpenChange?: (open: boolean) => void;
}

const VIEWPORT_MARGIN = 8;

/**
 * The chip icon's Frame: a rounded rectangle at the current proportion, centred
 * in the 16×16 viewBox. An extreme free proportion clamps to 3:1 so the shape
 * never collapses into an unreadable sliver.
 */
function ratioIcon(ratio: number) {
  const shaped = Number.isFinite(ratio) && ratio > 0 ? Math.min(3, Math.max(1 / 3, ratio)) : 1;
  const long = 12.2;
  const width = shaped >= 1 ? long : long * shaped;
  const height = shaped >= 1 ? long / shaped : long;
  return {
    x: (16 - width) / 2,
    y: (16 - height) / 2,
    width,
    height,
    radius: Math.max(0.9, Math.min(1.6, Math.min(width, height) / 2 - 0.6)),
  };
}

export const RatioMenu = memo(function RatioMenu({
  ratio,
  sourceRatio,
  snapEnabled,
  onRatio,
  onSnapEnabled,
  onOpenChange,
}: RatioMenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ left: 0, flip: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const orientation = ratioOrientation(ratio);
  const icon = ratioIcon(ratio);

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const close = useCallback(() => setOpen(false), []);
  const closeAndFocus = useCallback(() => {
    setOpen(false);
    chipRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const chip = chipRef.current;
    const popover = popoverRef.current;
    if (!chip || !popover) return;
    const chipRect = chip.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    let left = 0;
    const overflowRight = chipRect.left + popoverRect.width - (window.innerWidth - VIEWPORT_MARGIN);
    if (overflowRight > 0) left -= overflowRight;
    if (chipRect.left + left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN - chipRect.left;
    const below = chipRect.bottom + popoverRect.height;
    const flip =
      below > window.innerHeight - VIEWPORT_MARGIN &&
      chipRect.top - popoverRect.height > VIEWPORT_MARGIN;
    setPlacement({ left, flip });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, ratio, sourceRatio, snapEnabled, place]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    const target =
      popover?.querySelector<HTMLElement>('.ratio-row.on') ??
      popover?.querySelector<HTMLElement>('.ratio-row');
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close, closeAndFocus]);

  const options = presetsFor(orientation);

  const pick = (next: number, viaKeyboard = false) => {
    onRatio(next);
    if (viaKeyboard) closeAndFocus();
    else close();
  };
  return (
    <div className="ratio-menu" ref={menuRef}>
      <button
        ref={chipRef}
        type="button"
        className="ratio-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Proporção do Frame"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <rect
            x={icon.x}
            y={icon.y}
            width={icon.width}
            height={icon.height}
            rx={icon.radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
        <span>{ratioLabel(ratio)}</span>
        <span className="ratio-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={`ratio-popover${placement.flip ? ' flip' : ''}`}
          role="dialog"
          aria-label="Proporção do Frame"
          data-tauri-drag-region="false"
          style={{ left: placement.left }}
        >
          <ToggleGroup
            label="Orientação"
            value={orientation}
            onChange={() => onRatio(flipRatio(ratio))}
            disabled={orientation === 'square'}
            options={[
              { value: 'portrait', label: 'Retrato' },
              { value: 'landscape', label: 'Paisagem' },
            ]}
          />

          <div className="ratio-list" role="group" aria-label="Proporções">
            {sourceRatio !== null && (
              <button
                type="button"
                aria-pressed={matchesRatio(ratio, sourceRatio)}
                className={`ratio-row${matchesRatio(ratio, sourceRatio) ? ' on' : ''}`}
                onClick={(event) => pick(sourceRatio, event.detail === 0)}
              >
                <span>Fonte</span>
                <span className="ratio-value">
                  {formatAspect({ width: sourceRatio, height: 1 })}
                </span>
              </button>
            )}
            {options.map((preset) => {
              const selected = matchesRatio(ratio, preset.ratio);
              return (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={selected}
                  className={`ratio-row${selected ? ' on' : ''}`}
                  onClick={(event) => pick(preset.ratio, event.detail === 0)}
                >
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>

          <div className="ratio-divider" />
          <label className="ratio-snap">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(event) => onSnapEnabled(event.target.checked)}
            />
            <span>Encaixar proporções</span>
          </label>
        </div>
      )}
    </div>
  );
});
