import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { beginScrub, dragIntent, scrubTo, type ScrubGesture } from '../core/scrub';

interface NumberFieldProps {
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly label: string;
  readonly title?: string;
  readonly precision?: number;
  /** Change per pixel of vertical drag; defaults to one unit of the precision. */
  readonly step?: number;
  readonly disabled?: boolean;
}

function format(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0';
  if (precision !== 0) return value.toFixed(precision);
  // Round halves away from zero, so symmetric pan limits read as ±88 rather
  // than -87 / 88.
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return String(rounded === 0 ? 0 : rounded);
}

/**
 * A numeric field that edits locally and commits on blur or Enter, so typing
 * "0.", "-" or a value outside the limits never fights the clamp mid-keystroke.
 * It stays a text input to accept the comma a Portuguese keyboard produces.
 *
 * A vertical drag scrubs the value (up increases) while a sideways drag stays
 * the field's own text selection, so part of the number can be picked with the
 * mouse and typed over. Tab focus still selects the whole number.
 */
export function NumberField({
  value,
  onCommit,
  label,
  title,
  precision = 0,
  step,
  disabled = false,
}: NumberFieldProps) {
  const text = format(value, precision);
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const cancelRef = useRef(false);
  const gestureRef = useRef<ScrubGesture | null>(null);
  const startXRef = useRef(0);
  const selectingRef = useRef(false);
  const pointerFocusRef = useRef(false);
  // The value the next drag pixel applies to. A render refreshes it from the
  // prop, so a clamped commit is where the drag continues from.
  const valueRef = useRef(value);
  // The last value handed to onCommit. When the prop disagrees, the domain
  // clamped it, so the next move resumes from the realised value instead of
  // accumulating a dead-zone target.
  const requestedRef = useRef(value);
  const dragStep = step ?? (precision === 0 ? 1 : 10 ** -precision);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

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

  const endScrub = (event: ReactPointerEvent<HTMLInputElement>) => {
    gestureRef.current = null;
    selectingRef.current = false;
    pointerFocusRef.current = false;
    setScrubbing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <input
      className="num"
      type="text"
      inputMode="decimal"
      value={draft}
      aria-label={label}
      title={title}
      disabled={disabled}
      data-scrub={scrubbing ? 'true' : undefined}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => {
        setEditing(true);
        // A pointer press places the caret itself, so only a keyboard focus
        // selects the whole number for overwriting.
        if (!pointerFocusRef.current) event.currentTarget.select();
      }}
      onBlur={() => {
        // A press released outside the field never reaches pointer up; clear
        // the flag here so the next keyboard focus selects the whole number.
        pointerFocusRef.current = false;
        commit();
      }}
      onPointerDown={(event) => {
        if (disabled || !event.isPrimary || event.button !== 0) return;
        gestureRef.current = beginScrub(event.clientY);
        startXRef.current = event.clientX;
        selectingRef.current = false;
        pointerFocusRef.current = true;
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture) return;
        if (event.buttons === 0) {
          // The button was released outside the field, so this press is over.
          endScrub(event);
          return;
        }
        if (selectingRef.current) return;
        if (!gesture.active) {
          const intent = dragIntent(
            event.clientX - startXRef.current,
            event.clientY - gesture.startY,
          );
          if (intent === 'select') {
            // The sideways drag belongs to the input's own text selection.
            selectingRef.current = true;
            return;
          }
          if (intent !== 'scrub') return;
          // The press became a scrub: drop the selection and the draft it may
          // have started, then keep receiving moves outside the field.
          cancelRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.blur();
          setScrubbing(true);
        }
        if (value !== requestedRef.current) {
          valueRef.current = value;
          requestedRef.current = value;
        }
        const result = scrubTo(gesture, valueRef.current, event.clientY, dragStep);
        gestureRef.current = result.gesture;
        if (result.value === null) return;
        valueRef.current = result.value;
        requestedRef.current = result.value;
        onCommit(result.value);
      }}
      onPointerUp={(event) => {
        const dragged = gestureRef.current?.active ?? false;
        endScrub(event);
        if (dragged) {
          // Scrubbing blurred the field; take focus back so Tab continues from
          // here. The focus handler selects the number, so typing replaces it.
          event.currentTarget.focus();
        }
      }}
      onPointerCancel={endScrub}
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
