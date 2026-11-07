import {
  parseHistory,
  serializeHistory,
  type UploadRecord,
} from './history';
import { parseSettings, serializeSettings, type Settings } from './settings';

export const SETTINGS_KEY = 'settings';
export const UPLOADS_KEY = 'uploads';

export type ConfigKey = typeof SETTINGS_KEY | typeof UPLOADS_KEY;

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

export async function loadHistory(store: ConfigStore): Promise<UploadRecord[]> {
  return parseHistory(await store.read(UPLOADS_KEY));
}

export async function saveHistory(
  store: ConfigStore,
  records: readonly UploadRecord[],
): Promise<void> {
  await store.write(UPLOADS_KEY, serializeHistory(records));
}
