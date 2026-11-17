import { useMemo, useSyncExternalStore } from 'react';
import { activeLocale, subscribeLocale } from '../core/i18n/active';
import type { Locale } from '../core/i18n/locale';
import { messagesFor } from '../core/i18n/messages';
import { renderMessage, type MessageParams, type TextRef } from '../core/i18n/text';
import type { MessageKey, MessageParamsFor } from '../core/i18n/messages.pt-BR';

export interface I18n {
  readonly locale: Locale;
  readonly t: <K extends MessageKey>(key: K, params?: MessageParamsFor<K>) => string;
  /** Resolve a key plus parameters that arrived as one value. */
  readonly tr: (ref: TextRef) => string;
}

/**
 * The language the window is drawn in, subscribed rather than passed down: a
 * switch has to repaint every mounted component, including a dialog that is
 * already open and a notice that is already on screen.
 *
 * The returned object is memoised per language. `t` and `tr` are closures, so a
 * fresh one per render would make every `useCallback`/`useEffect` that lists `t`
 * in its dependencies re-run on every render — including the boot effect that
 * reads `settings.json`.
 */
export function useI18n(): I18n {
  const locale = useSyncExternalStore(subscribeLocale, activeLocale, activeLocale);
  return useMemo(() => {
    const messages = messagesFor(locale);
    return {
      locale,
      t: (key: MessageKey, params?: MessageParams) => renderMessage(messages[key], params, locale),
      tr: (ref: TextRef) => renderMessage(messages[ref.key], ref.params, locale),
    };
  }, [locale]);
}
