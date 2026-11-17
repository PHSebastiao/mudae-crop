import { intlLocale, type Locale } from './i18n/locale';

/**
 * Locale-aware number readouts. The app used to hardcode a decimal comma, which
 * is right for pt-BR and Spanish and wrong for the other four languages, so
 * every readout that shows a fraction goes through here.
 *
 * Formatters are cached: building one is far more expensive than using it, and
 * a rail repaints on every pointer move.
 */
const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: Locale, digits: number, trim: boolean): Intl.NumberFormat {
  const key = `${locale}:${digits}:${trim ? 't' : 'f'}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: trim ? 0 : digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
  formatters.set(key, created);
  return created;
}

/** A fixed number of decimals in the locale's separator: `2,50` vs `2.50`. */
export function decimal(value: number, digits: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '0';
  return formatter(locale, digits, false).format(value);
}

/** The same with trailing zeros dropped: `1` and `0,75` rather than `1,00`. */
export function decimalTrimmed(value: number, digits: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '0';
  return formatter(locale, digits, true).format(value);
}

/** A rounded whole percent, e.g. `37%`. */
export function wholePercent(value: number, locale: Locale): string {
  return `${formatter(locale, 0, true).format(value)}%`;
}

/** A byte count in the largest unit that keeps it readable, e.g. `12,4 MB`. */
export function formatBytes(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${decimal(value, digits, locale)} ${units[exponent]}`;
}
