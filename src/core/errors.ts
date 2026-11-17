import type { TextRef } from './i18n/text';

/**
 * An error whose user-facing message is a catalog key rather than a sentence.
 *
 * `src/core` and `src/platform` must not hold prose: a thrown `KeyedError` keeps
 * the key, and the UI resolves it in the language that is active when the text
 * is drawn — so switching the language repaints an error that is already on
 * screen. `message` stays the key for logs and for a caller that only wants a
 * developer-facing string.
 */
export class KeyedError extends Error {
  readonly text: TextRef;

  constructor(message: TextRef) {
    super(message.key);
    this.name = 'KeyedError';
    this.text = message;
  }
}
