import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ConfigKey, ConfigStore } from '../core/config';

const tauriConfigStore: ConfigStore = {
  async read(key: ConfigKey) {
    return (await invoke<string | null>('read_config', { key })) ?? null;
  },
  async write(key: ConfigKey, contents: string) {
    await invoke('write_config', { key, contents });
  },
};

/**
 * `npm run dev` runs without Tauri; keeping the same keys in localStorage lets
 * Settings be exercised in the browser without pretending to be the real store.
 */
function browserConfigStore(): ConfigStore {
  const prefix = 'mudae-crop:';
  return {
    async read(key: ConfigKey) {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    async write(key: ConfigKey, contents: string) {
      try {
        localStorage.setItem(prefix + key, contents);
      } catch {
        // A browser without storage degrades to defaults, never a crash.
      }
    },
  };
}

export const configStore: ConfigStore = isTauri() ? tauriConfigStore : browserConfigStore();
