import { useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly label: string;
  readonly precision?: number;
  readonly disabled?: boolean;
}

function format(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0';
  return precision === 0 ? String(Math.round(value)) : value.toFixed(precision);
}

/**
 * A numeric field that edits locally and commits on blur or Enter, so typing
 * "0.", "-" or a value outside the limits never fights the clamp mid-keystroke.
 * It stays a text input to accept the comma a Portuguese keyboard produces.
 */
export function NumberField({
  value,
  onCommit,
  label,
  precision = 0,
  disabled = false,
}: NumberFieldProps) {
  const text = format(value, precision);
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(text);
      setEditing(false);
      return;
    }
    const cleaned = draft.trim().replace(',', '.');
    const parsed = cleaned === '' ? Number.NaN : Number(cleaned);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(text);
    setEditing(false);
  };

  return (
    <input
      className="num"
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label={label}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        setEditing(true);
        event.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}
