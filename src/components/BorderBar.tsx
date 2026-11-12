import { useLayoutEffect, useRef, useState } from 'react';
import type { Border } from '../core/document';
import { withWhiteFirst, type PaletteColor } from '../core/palette';
import { HexInput } from './HexInput';
import { NumberField } from './NumberField';

interface BorderBarProps {
  readonly border: Border;
  readonly palette: readonly PaletteColor[];
  readonly hasSource: boolean;
  readonly onColor: (color: string) => void;
  readonly onWidth: (width: number) => void;
  readonly onCopy: (hex: string) => void;
  readonly onRecalc: () => void;
}

export function BorderBar({
  border,
  palette,
  hasSource,
  onColor,
  onWidth,
  onCopy,
  onRecalc,
}: BorderBarProps) {
  const swatches = hasSource ? withWhiteFirst(palette) : [];
  const listRef = useRef<HTMLDivElement | null>(null);
  // The selection ring is one element that travels, so it needs the centre of
  // the selected swatch in the palette's own coordinates. Swatches wrap, so
  // the position is re-measured whenever the palette resizes.
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const selected = list.querySelector<HTMLElement>('.palette-swatch.selected');
      setRing(
        selected
          ? {
              x: selected.offsetLeft + selected.offsetWidth / 2,
              y: selected.offsetTop + selected.offsetHeight / 2,
            }
          : null,
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [border.color, hasSource, palette]);

  return (
    <footer className="border-bar">
      <div className="border-row">
        <span className="label">Borda</span>
        <div className="current-color">
          <span className="swatch" style={{ background: border.color }} />
          <HexInput value={border.color} onCommit={onColor} label="HEX da Borda" />
          <button
            type="button"
            className="copy"
            onClick={() => onCopy(border.color)}
            title="Copiar o hex da Borda"
          >
            copiar
          </button>
        </div>
        <span className="field">
          <NumberField value={border.width} onCommit={onWidth} label="Largura da Borda" />
          <span className="unit">px</span>
        </span>
        <span className="border-sep" aria-hidden="true" />
        <div
          className="palette"
          ref={listRef}
          role="group"
          aria-label="Cores da imagem"
          title="Cores da imagem"
        >
          <span
            className="palette-ring"
            aria-hidden="true"
            data-visible={ring ? 'true' : 'false'}
            style={ring ? { transform: `translate3d(${ring.x}px, ${ring.y}px, 0)` } : undefined}
          />
          {swatches.map((color) => {
            const selected = color.hex === border.color;
            return (
              <button
                key={color.hex}
                type="button"
                className={`palette-swatch${selected ? ' selected' : ''}`}
                style={{ background: color.hex }}
                title={
                  color.count === 0 ? color.hex : `${color.hex} · ${Math.round(color.share * 100)}%`
                }
                aria-label={`Borda ${color.hex}`}
                aria-pressed={selected}
                onClick={() => onColor(color.hex)}
                disabled={!hasSource}
              />
            );
          })}
          {swatches.length === 0 && <span className="muted">sem cores</span>}
        </div>
        <button
          type="button"
          className="recalc"
          onClick={onRecalc}
          disabled={!hasSource}
          title="Recalcular a Palette a partir do Crop atual"
        >
          recalcular
        </button>
      </div>
    </footer>
  );
}
