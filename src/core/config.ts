import {
  parseHistory,
  serializeHistory,
  type HistoryEntry,
} from './history';
import { parseSettings, serializeSettings, type Settings } from './settings';

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

export async function loadSettings(store: ConfigStore): Promise<Settings> {
  return parseSettings(await store.read(SETTINGS_KEY));
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
