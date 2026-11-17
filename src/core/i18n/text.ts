import type { MessageKey, MessageParamsFor } from './messages.pt-BR';
import { messagesFor } from './messages';
import { activeLocale } from './active';
import type { Locale } from './locale';

export type MessageParams = Readonly<Record<string, string | number | TextRef>>;

/**
 * A message that has not been resolved against a locale yet. Notices and
 * errors carry this instead of a sentence, so a language switch re-renders
 * text that is already on screen instead of leaving it stranded.
 */
export interface TextRef {
  readonly key: MessageKey;
  readonly params?: MessageParams;
}

/**
 * Built through a key, so the parameters are checked against the message's own
 * placeholders exactly like `t()`: the error path must not be the one place a
 * typo can reach the screen.
 */
export function text<K extends MessageKey>(key: K, params?: MessageParamsFor<K>): TextRef {
  return params ? { key, params } : { key };
}

/** How deep a message may nest another before the placeholder is left alone. */
const MAX_NESTING = 4;

/**
 * Replace `{name}` placeholders. A missing parameter leaves the placeholder.
 *
 * A parameter may itself be a `TextRef`, which is how a sentence carries another
 * keyed phrase — the publication a batch uploaded to, or the reason an export
 * failed. The nested phrase renders in the same `locale` as the sentence that
 * holds it, so an explicit-locale render stays in one language throughout.
 */
export function renderMessage(
  pattern: string,
  params?: MessageParams,
  locale: Locale = activeLocale(),
  depth = 0,
): string {
  if (!params) return pattern;
  return pattern.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    if (typeof value !== 'object') return String(value);
    if (depth >= MAX_NESTING) return match;
    return renderMessage(messagesFor(locale)[value.key], value.params, locale, depth + 1);
  });
}

/**
 * The keyed message of an error that carries one. Anything else — a native
 * rejection, a `TypeError` — has no key and the caller decides what to show.
 */
export function textOf(reason: unknown): TextRef | null {
  if (!reason || typeof reason !== 'object' || !('text' in reason)) return null;
  const value = (reason as { text?: unknown }).text;
  if (!value || typeof value !== 'object' || !('key' in value)) return null;
  return value as TextRef;
}
