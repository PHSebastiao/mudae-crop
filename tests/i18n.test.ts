import { describe, expect, it } from 'vitest';
import { decimal, decimalTrimmed, formatBytes, wholePercent } from '../src/core/format';
import { activeLocale, setActiveLocale, subscribeLocale } from '../src/core/i18n/active';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  detectLocale,
  intlLocale,
  isLocale,
} from '../src/core/i18n/locale';
import { messagesFor, t, translate } from '../src/core/i18n/messages';
import { en } from '../src/core/i18n/messages.en';
import { es } from '../src/core/i18n/messages.es';
import { ja } from '../src/core/i18n/messages.ja';
import { ptBR, type Catalog } from '../src/core/i18n/messages.pt-BR';
import { ru } from '../src/core/i18n/messages.ru';
import { zhHans } from '../src/core/i18n/messages.zh-Hans';
import { renderMessage, text } from '../src/core/i18n/text';

describe('locale', () => {
  it('maps a system tag by its language subtag only', () => {
    expect(detectLocale('pt-BR')).toBe('pt-BR');
    expect(detectLocale('pt-PT')).toBe('pt-BR');
    expect(detectLocale('es-419')).toBe('es');
    expect(detectLocale('en-GB')).toBe('en');
    expect(detectLocale('ru-RU')).toBe('ru');
    expect(detectLocale('JA-jp')).toBe('ja');
    expect(detectLocale('zh_CN')).toBe('zh-Hans');
  });

  it('sends every Chinese variant to Simplified', () => {
    expect(detectLocale('zh-TW')).toBe('zh-Hans');
    expect(detectLocale('zh-HK')).toBe('zh-Hans');
    expect(detectLocale('zh-Hant')).toBe('zh-Hans');
  });

  it('falls back to English for an unsupported or missing language', () => {
    expect(detectLocale('fr-FR')).toBe('en');
    expect(detectLocale('de')).toBe('en');
    expect(detectLocale('')).toBe('en');
    expect(detectLocale(null)).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
    expect(DEFAULT_LOCALE).toBe('en');
  });

  it('only accepts a tag it supports', () => {
    expect(isLocale('ja')).toBe(true);
    expect(isLocale('zh-Hans')).toBe(true);
    expect(isLocale('pt')).toBe(false);
    expect(isLocale(7)).toBe(false);
  });

  it('names every language in its own words', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale].length).toBeGreaterThan(0);
    }
    expect(LOCALE_LABELS['pt-BR']).toBe('Português');
    expect(LOCALE_LABELS.ja).toBe('日本語');
  });

  it('hands Intl a region for the Simplified Chinese script', () => {
    expect(intlLocale('zh-Hans')).toBe('zh-CN');
    expect(intlLocale('pt-BR')).toBe('pt-BR');
  });
});

describe('messages', () => {
  it('replaces a parameter and leaves an unknown one alone', () => {
    expect(renderMessage('{a} de {b}', { a: 1, b: 2 })).toBe('1 de 2');
    expect(renderMessage('{a} de {b}', { a: 1 })).toBe('1 de {b}');
    expect(renderMessage('sem parametros')).toBe('sem parametros');
  });

  it('builds a text reference with and without parameters', () => {
    expect(text('common.close')).toEqual({ key: 'common.close' });
    expect(text('rail.framesOf', { trimmed: 3, total: 9 })).toEqual({
      key: 'rail.framesOf',
      params: { trimmed: 3, total: 9 },
    });
  });

  it('checks a text reference against the message placeholders too', () => {
    // @ts-expect-error - `total` is misspelled as `toto`.
    text('rail.framesOf', { trimmed: 3, toto: 9 });
  });

  it('resolves a key in an explicit locale', () => {
    expect(translate('pt-BR', 'common.close')).toBe('Fechar');
    expect(translate('pt-BR', 'rail.framesOf', { trimmed: 3, total: 9 })).toBe('3 de 9');
  });

  it('rejects a parameter the message does not declare', () => {
    translate('pt-BR', 'app.exported', {
      label: 'PNG',
      width: 450,
      height: 700,
      name: 'card.png',
      // @ts-expect-error - `wight` is not a placeholder of `app.exported`.
      wight: 450,
    });
  });

  it('renders a keyed phrase nested inside a sentence', () => {
    const reason = text('export.errNoSource');
    const pt = translate('pt-BR', 'app.exportFailed', { label: 'PNG', reason });
    expect(pt).toContain('Não há origem para exportar.');
    expect(pt).not.toContain('{');

    // The nested phrase follows the language it is rendered in, not the key.
    const ja = translate('ja', 'app.exportFailed', { label: 'PNG', reason });
    expect(ja).toContain(translate('ja', 'export.errNoSource'));
    expect(ja).not.toContain('{');
  });

  it('stops at a nesting depth instead of looping', () => {
    const params: Record<string, unknown> = { label: 'x' };
    params.reason = { key: 'app.exportFailed', params };
    const rendered = translate('pt-BR', 'app.exportFailed', params as never);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('resolves each language to its own catalog', () => {
    expect(messagesFor('pt-BR')).toBe(ptBR);
    expect(messagesFor('ja')).toBe(ja);
    expect(messagesFor('zh-Hans')).toBe(zhHans);
  });

  it('follows the active locale', () => {
    const before = activeLocale();
    try {
      setActiveLocale('pt-BR');
      expect(t('common.close')).toBe('Fechar');
    } finally {
      setActiveLocale(before);
    }
  });

  it('notifies subscribers on a real change only', () => {
    const before = activeLocale();
    const seen: string[] = [];
    const stop = subscribeLocale(() => seen.push(activeLocale()));
    try {
      setActiveLocale('ja');
      setActiveLocale('ja');
      setActiveLocale(before);
    } finally {
      stop();
    }
    expect(seen).toEqual(['ja', before]);
  });

  it('has no empty message in the reference catalog', () => {
    for (const [key, value] of Object.entries(ptBR)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('keeps every placeholder of a key spelled the same way', () => {
    for (const [key, value] of Object.entries(ptBR)) {
      const names = [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      for (const name of names) {
        expect(name, `${key} uses ${name}`).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
      }
      expect(new Set(names).size, key).toBe(names.length);
    }
  });
});

const EVERY_CATALOG: ReadonlyArray<readonly [string, Catalog]> = [
  ['pt-BR', ptBR],
  ['en', en],
  ['es', es],
  ['ru', ru],
  ['ja', ja],
  ['zh-Hans', zhHans],
];

describe('catalogs', () => {
  it('has exactly the reference keys in every language', () => {
    const keys = Object.keys(ptBR).sort();
    for (const [locale, catalog] of EVERY_CATALOG) {
      expect(Object.keys(catalog).sort(), locale).toEqual(keys);
    }
  });

  it('keeps every placeholder identical across languages', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [locale, catalog] of EVERY_CATALOG) {
      for (const key of Object.keys(ptBR) as Array<keyof typeof ptBR>) {
        expect(placeholders(catalog[key]), `${locale} ${key}`).toEqual(placeholders(ptBR[key]));
      }
    }
  });

  it('has no empty value in any language', () => {
    for (const [locale, catalog] of EVERY_CATALOG) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('does not ship English prose where the reference differs', () => {
    for (const [locale, catalog] of EVERY_CATALOG.slice(1)) {
      if (locale === 'en') continue;
      const prose = (Object.keys(ptBR) as Array<keyof typeof ptBR>).filter(
        (key) => ptBR[key] !== en[key] && ptBR[key].length > 12 && /\p{L}/u.test(ptBR[key]),
      );
      const copied = prose.filter((key) => catalog[key] === en[key]);
      // A short cognate (es "Color") is fine; a copied English sentence is not.
      expect(copied, locale).toEqual([]);
    }
  });

  it('keeps English prose out of the reference catalog', () => {
    // A Portuguese sentence does not carry English function words. This catches
    // prose pasted from the English catalog, while a format list, a placeholder
    // template and a shared proper noun stay legal.
    const english =
      /\b(the|and|with|your|this|that|from|before|after|while|should|unknown|failure|failed|missing|unable|cannot)\b/i;
    const copied = (Object.keys(ptBR) as Array<keyof typeof ptBR>).filter((key) =>
      english.test(ptBR[key]),
    );
    expect(copied).toEqual([]);
  });

  it('actually translates the reference copy', () => {
    for (const [locale, catalog] of EVERY_CATALOG.slice(1)) {
      const keys = Object.keys(ptBR) as Array<keyof typeof ptBR>;
      // A value identical in all six catalogs is data, not prose: the format
      // list, a symbol row, a proper noun. Those are excluded so the budget
      // measures translation, and a half-copied file still fails.
      const shared = (key: keyof typeof ptBR) =>
        EVERY_CATALOG.every(([, other]) => other[key] === ptBR[key]);
      const prose = keys.filter(
        (key) => !shared(key) && ptBR[key].length > 12 && /\p{L}/u.test(ptBR[key]),
      );
      const translated = prose.filter((key) => catalog[key] !== ptBR[key]).length;
      expect(translated / prose.length, locale).toBeGreaterThan(0.9);
      expect(catalog['rail.adjustFrame'], locale).not.toBe(ptBR['rail.adjustFrame']);
    }
  });
});

describe('formatting', () => {
  it('writes a decimal in the locale separator', () => {
    expect(decimal(2.5, 2, 'pt-BR')).toBe('2,50');
    expect(decimal(2.5, 2, 'es')).toBe('2,50');
    expect(decimal(2.5, 2, 'en')).toBe('2.50');
    expect(decimal(2.5, 2, 'ja')).toBe('2.50');
    expect(decimal(2.5, 2, 'zh-Hans')).toBe('2.50');
    expect(decimal(2.5, 2, 'ru')).toBe('2,50');
  });

  it('drops trailing zeros when the readout does not need them', () => {
    expect(decimalTrimmed(1, 2, 'pt-BR')).toBe('1');
    expect(decimalTrimmed(0.75, 2, 'pt-BR')).toBe('0,75');
    expect(decimalTrimmed(0.75, 2, 'en')).toBe('0.75');
  });

  it('formats a whole percent in the locale digits', () => {
    expect(wholePercent(37.4, 'pt-BR')).toBe('37%');
    expect(wholePercent(37.4, 'ja')).toBe('37%');
  });

  it('formats bytes with the locale separator and no grouping', () => {
    expect(formatBytes(1024, 'pt-BR')).toBe('1,0 KB');
    expect(formatBytes(1024, 'en')).toBe('1.0 KB');
    expect(formatBytes(12.4 * 1024 * 1024, 'pt-BR')).toBe('12,4 MB');
    expect(formatBytes(0, 'en')).toBe('0 B');
  });
});
