/**
 * The six UI languages. `zh-Hans` is the only Chinese: every `zh-*` tag maps to
 * it, so a Traditional reader gets Simplified rather than English.
 */
export const LOCALES = ['pt-BR', 'en', 'es', 'ru', 'ja', 'zh-Hans'] as const;

export type Locale = (typeof LOCALES)[number];

/** What an unknown or unsupported system language falls back to. */
export const DEFAULT_LOCALE: Locale = 'en';

/** The language the copy is written in first, and the key reference. */
export const SOURCE_LOCALE: Locale = 'pt-BR';

/**
 * Each language names itself: someone lost in the wrong language has to
 * recognise their own option, so these are never translated.
 */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = Object.freeze({
  'pt-BR': 'Português',
  en: 'English',
  es: 'Español',
  ru: 'Русский',
  ja: '日本語',
  'zh-Hans': '中文',
});

const LANGUAGE_LOCALE: Readonly<Record<string, Locale>> = Object.freeze({
  pt: 'pt-BR',
  en: 'en',
  es: 'es',
  ru: 'ru',
  ja: 'ja',
  zh: 'zh-Hans',
});

/**
 * Map a system tag (`pt-BR`, `zh_TW`, `es-419`, …) to a supported language.
 * Only the language subtag decides: a `pt-PT` user reads pt-BR rather than
 * English, and every Chinese variant reads Simplified.
 */
export function detectLocale(tag: string | null | undefined): Locale {
  const language = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_LOCALE[language] ?? DEFAULT_LOCALE;
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The BCP-47 tag `Intl` understands. `zh-Hans` is a script, not a region. */
export function intlLocale(locale: Locale): string {
  return locale === 'zh-Hans' ? 'zh-CN' : locale;
}
