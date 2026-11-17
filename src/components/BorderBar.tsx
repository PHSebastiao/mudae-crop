import { useLayoutEffect, useRef, useState } from 'react';
import type { Border } from '../core/document';
import { withWhiteFirst, type PaletteColor } from '../core/palette';
import { wholePercent } from '../core/format';
import { useI18n } from '../hooks/useI18n';
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
  const { locale, t } = useI18n();
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
    <footer className="border-bar" id="tour-border">
      <div className="border-row">
        <span className="label">{t('border.label')}</span>
        <div className="current-color">
          <span className="swatch" style={{ background: border.color }} />
          <HexInput value={border.color} onCommit={onColor} label={t('border.hexLabel')} />
          <button
            type="button"
            className="copy"
            onClick={() => onCopy(border.color)}
            title={t('border.copyTitle')}
          >
            {t('border.copy')}
          </button>
        </div>
        <span className="field">
          <NumberField value={border.width} onCommit={onWidth} label={t('border.widthLabel')} />
          <span className="unit">px</span>
        </span>
        <span className="border-sep" aria-hidden="true" />
        <div
          className="palette"
          ref={listRef}
          role="group"
          aria-label={t('border.palette')}
          title={t('border.palette')}
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
                  color.count === 0
                    ? color.hex
                    : `${color.hex} · ${wholePercent(color.share * 100, locale)}`
                }
                aria-label={t('border.swatchLabel', { hex: color.hex })}
                aria-pressed={selected}
                onClick={() => onColor(color.hex)}
                disabled={!hasSource}
              />
            );
          })}
          {swatches.length === 0 && <span className="muted">{t('border.empty')}</span>}
        </div>
        <button
          type="button"
          className="recalc"
          onClick={onRecalc}
          disabled={!hasSource}
          title={t('border.recalcTitle')}
        >
          {t('border.recalc')}
        </button>
      </div>
    </footer>
  );
}
