import { parseHistory, serializeHistory, type HistoryEntry } from './history';
import { parseSettings, serializeSettings, settingsHasLanguage, type Settings } from './settings';
import type { Locale } from './i18n/locale';

export const SETTINGS_KEY = 'settings';
/** Holds every History entry: uploads and local Exports. */
export const HISTORY_KEY = 'history';

export type ConfigKey = typeof SETTINGS_KEY | typeof HISTORY_KEY;

/**
 * The small storage seam: the desktop app writes JSON files in the app config
 * directory through Tauri, the browser dev build keeps the same shape in
 * localStorage, and tests use a map.
 */
export interface ConfigStore {
  read(key: ConfigKey): Promise<string | null>;
  write(key: ConfigKey, contents: string): Promise<void>;
}

export interface LoadedSettings {
  readonly settings: Settings;
  /**
   * The file had never named a language, so the detected one was used and still
   * has to be written back: the detection happens once, not on every launch.
   */
  readonly needsWrite: boolean;
}

export async function loadSettings(store: ConfigStore, detected: Locale): Promise<LoadedSettings> {
  const raw = await store.read(SETTINGS_KEY);
  return { settings: parseSettings(raw, detected), needsWrite: !settingsHasLanguage(raw) };
}

export async function saveSettings(store: ConfigStore, settings: Settings): Promise<void> {
  await store.write(SETTINGS_KEY, serializeSettings(settings));
}

export async function loadHistory(store: ConfigStore): Promise<HistoryEntry[]> {
  return parseHistory(await store.read(HISTORY_KEY));
}

export async function saveHistory(
  store: ConfigStore,
  entries: readonly HistoryEntry[],
): Promise<void> {
  await store.write(HISTORY_KEY, serializeHistory(entries));
}
