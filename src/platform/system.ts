import { invoke, isTauri } from '@tauri-apps/api/core';
import { locale } from '@tauri-apps/plugin-os';
import { text } from '../core/i18n/text';
import { KeyedError } from '../core/errors';

/**
 * The language the operating system is set to, as a BCP-47 tag. The desktop app
 * asks Windows; the browser build falls back to the webview's own language.
 * `null` means "could not tell", and the caller picks the default.
 */
export async function systemLocale(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await locale();
    } catch {
      return null;
    }
  }
  return typeof navigator === 'undefined' ? null : navigator.language;
}

/**
 * Clipboard and browser work go through the native side on desktop: the webview
 * clipboard needs a user gesture that an upload finishing later no longer has.
 */
export async function copyText(text: string): Promise<void> {
  if (isTauri()) {
    await invoke('copy_text', { text });
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await invoke('open_external', { url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Show a saved Export in the native file manager, selecting the file. */
export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauri()) {
    throw new KeyedError(text('system.explorerDesktopOnly'));
  }
  await invoke('reveal_path', { path });
}
