import { DEFAULT_LOCALE, type Locale } from './locale';

/**
 * The language the window is drawn in. Settings owns the value; this module
 * only holds it so `src/core` can resolve a message without every call site
 * threading a locale through. Formatting still takes the locale explicitly,
 * so the pure math stays pure.
 */
let active: Locale = DEFAULT_LOCALE;

const listeners = new Set<() => void>();

export function activeLocale(): Locale {
  return active;
}

export function setActiveLocale(locale: Locale): void {
  if (locale === active) return;
  active = locale;
  for (const listener of listeners) listener();
}

/** Subscribed by `useI18n`, so every component re-renders on a switch. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
