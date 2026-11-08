import { useEffect, useRef, useState } from 'react';
import { normalizeHexColor } from '../core/color';

interface HexInputProps {
  readonly value: string;
  readonly onCommit: (hex: string) => void;
  readonly label: string;
  readonly className?: string;
  readonly disabled?: boolean;
}

/**
 * A small editable HEX field. The draft stays local until Enter or blur, so a
 * half-typed value never repaints the Border or the Pad. Escape cancels.
 */
export function HexInput({ value, onCommit, label, className, disabled = false }: HexInputProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!cancelRef.current) {
      setDraft(value);
      setInvalid(false);
    }
  }, [value]);

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(value);
      setInvalid(false);
      return;
    }
    const normalized = normalizeHexColor(draft);
    if (!normalized) {
      setDraft(value);
      setInvalid(true);
      return;
    }
    setDraft(normalized);
    setInvalid(false);
    if (normalized !== value) onCommit(normalized);
  };

  return (
    <input
      type="text"
      className={`hex-input${className ? ` ${className}` : ''}`}
      value={draft}
      onChange={(event) => {
        setInvalid(false);
        setDraft(event.target.value);
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
      aria-label={label}
      aria-invalid={invalid}
      title={invalid ? 'HEX inválido. Use #RRGGBB.' : 'HEX · Enter aplica · Esc cancela'}
      maxLength={7}
      spellCheck={false}
      autoComplete="off"
      disabled={disabled}
    />
  );
}
