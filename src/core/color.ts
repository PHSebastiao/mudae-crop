/** Hex color parsing shared by the Border, the Palette and settings. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const SIX_DIGIT = /^#?([0-9a-f]{6})$/i;

/** `#RRGGBB` in upper case, or null when the value is not a six-digit hex. */
export function normalizeHexColor(value: string): string | null {
  const match = SIX_DIGIT.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

export function parseHexColor(value: string): Rgb | null {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  const int = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

export function toHexColor(color: Rgb): string {
  const channel = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
}
