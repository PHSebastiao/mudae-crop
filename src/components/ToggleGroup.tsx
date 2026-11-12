import type { CSSProperties } from 'react';

export interface ToggleOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
  readonly title?: string;
  readonly disabled?: boolean;
}

interface ToggleGroupProps<T extends string | number> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ToggleOption<T>[];
  readonly onChange: (value: T) => void;
  /** Segments per row; omitted means one row, and the Scale group passes 2. */
  readonly columns?: number;
  readonly className?: string;
  readonly disabled?: boolean;
}

/**
 * A segmented group of exclusive options whose selected segment slides into
 * place instead of lighting up where it stands. The pill is one absolutely
 * positioned element placed from `--toggle-*` custom properties, so moving it
 * is a single transform transition while the buttons keep their own text,
 * focus ring and press feedback.
 */
export function ToggleGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  columns,
  className,
  disabled = false,
}: ToggleGroupProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  const active = index >= 0;
  // One row unless the caller asks for a grid: the pill's width is one column
  // of the surface, so the count of segments in a row is what it divides by.
  const cols = Math.max(1, Math.min(columns ?? options.length, options.length));
  const rows = Math.max(1, Math.ceil(options.length / cols));
  // A value outside the options (a square Frame has no Orientation) leaves the
  // pill hidden rather than parked under the first segment.
  const style = {
    '--toggle-cols': cols,
    '--toggle-rows': rows,
    '--toggle-col': active ? index % cols : 0,
    '--toggle-row': active ? Math.floor(index / cols) : 0,
  } as CSSProperties;

  return (
    <div
      className={className ? `toggle ${className}` : 'toggle'}
      role="group"
      aria-label={label}
      data-active={active ? 'true' : 'false'}
      style={style}
    >
      <span className="toggle-thumb" aria-hidden="true" />
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            className={on ? 'on' : ''}
            aria-pressed={on}
            title={option.title}
            disabled={disabled || option.disabled}
            onClick={() => {
              if (!on) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
