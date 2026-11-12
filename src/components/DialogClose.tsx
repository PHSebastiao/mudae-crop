/**
 * A dialog header's close button. The cross is drawn as two SVG strokes instead
 * of a `×` glyph: the glyph sits on the font's baseline, so its ink lands below
 * the centre of the button, while these strokes are centred by construction.
 */
export function DialogClose({
  label,
  onClick,
}: {
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className="icon" onClick={onClick} aria-label={label}>
      <svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <path
          d="M3.5 3.5l7 7M10.5 3.5l-7 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
