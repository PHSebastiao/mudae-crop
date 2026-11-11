import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flipRatio, matchesRatio, presetsFor, ratioLabel, ratioOrientation } from '../core/ratios';

import { formatAspect } from '../core/size';

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
            x="3.4"
            y="1.9"
            width="9.2"
            height="12.2"
            rx="1.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M3.4 5.2h9.2" stroke="currentColor" strokeWidth="1.2" />
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
          style={{ left: placement.left }}
        >
          <div className="toggle" role="group" aria-label="Orientação">
            <button
              type="button"
              className={orientation === 'portrait' ? 'on' : ''}
              aria-pressed={orientation === 'portrait'}
              disabled={orientation === 'square'}
              onClick={() => {
                if (orientation !== 'portrait') onRatio(flipRatio(ratio));
              }}
            >
              Retrato
            </button>
            <button
              type="button"
              className={orientation === 'landscape' ? 'on' : ''}
              aria-pressed={orientation === 'landscape'}
              disabled={orientation === 'square'}
              onClick={() => {
                if (orientation !== 'landscape') onRatio(flipRatio(ratio));
              }}
            >
              Paisagem
            </button>
          </div>

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
