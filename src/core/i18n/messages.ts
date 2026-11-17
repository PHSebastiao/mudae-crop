import { activeLocale } from './active';
import { intlLocale, type Locale } from './locale';
import { en } from './messages.en';
import { es } from './messages.es';
import { ja } from './messages.ja';
import { ptBR, type Catalog, type MessageKey, type MessageParamsFor } from './messages.pt-BR';
import { ru } from './messages.ru';
import { zhHans } from './messages.zh-Hans';
import { renderMessage, type MessageParams } from './text';

/**
 * One catalog per language. `Record<Locale, Catalog>` is what makes a language
 * complete or unbuildable: `Catalog` requires every key, and `Locale` requires
 * every language. Adding a tag without a file stops compiling.
 */
const CATALOGS: Readonly<Record<Locale, Catalog>> = Object.freeze({
  'pt-BR': ptBR,
  en,
  es,
  ru,
  ja,
  'zh-Hans': zhHans,
});

export function messagesFor(locale: Locale): Catalog {
  return CATALOGS[locale];
}

/** Resolve one message in an explicit locale; used where no hook can run. */
export function translate<K extends MessageKey>(
  locale: Locale,
  key: K,
  params?: MessageParamsFor<K>,
): string {
  return renderMessage(CATALOGS[locale][key], params as MessageParams | undefined, locale);
}

/** Resolve one message in the language the window is drawn in. */
export function t<K extends MessageKey>(key: K, params?: MessageParamsFor<K>): string {
  return translate(activeLocale(), key, params);
}

export { intlLocale };
export type { Catalog, MessageKey };
