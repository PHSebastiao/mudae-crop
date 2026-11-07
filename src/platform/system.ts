import { invoke, isTauri } from '@tauri-apps/api/core';

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
    throw new Error('o Explorador só abre no app desktop');
  }
  await invoke('reveal_path', { path });
}
