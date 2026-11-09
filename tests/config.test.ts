import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  SETTINGS_KEY,
  loadHistory,
  loadSettings,
  saveHistory,
  saveSettings,
  type ConfigStore,
} from '../src/core/config';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { MAX_HISTORY, type HistoryEntry } from '../src/core/history';
import { makeExportEntry, makeUploadEntry } from './helpers';

class MemoryStore implements ConfigStore {
  readonly files = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.files.get(key) ?? null;
  }

  async write(key: string, contents: string): Promise<void> {
    this.files.set(key, contents);
  }
}

describe('config store', () => {
  it('loads defaults from an empty store', async () => {
    const store = new MemoryStore();

    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(await loadHistory(store)).toEqual([]);
  });

  it('persists settings and history in separate files', async () => {
    const store = new MemoryStore();
    const settings = { ...DEFAULT_SETTINGS, token: 'abc', frameRatio: 16 / 9 };
    const history: HistoryEntry[] = [makeUploadEntry(1), makeExportEntry(2)];

    await saveSettings(store, settings);
    await saveHistory(store, history);

    expect([...store.files.keys()].sort()).toEqual([SETTINGS_KEY, HISTORY_KEY].sort());
    expect(await loadSettings(store)).toEqual(settings);
    expect(await loadHistory(store)).toEqual(history);
  });

  it('falls back to defaults when a file is corrupt', async () => {
    const store = new MemoryStore();
    await store.write(SETTINGS_KEY, '{broken');
    await store.write(HISTORY_KEY, 'not json');

    expect(await loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(await loadHistory(store)).toEqual([]);
  });

  it('round-trips the Frame ratio and snapping preference', async () => {
    const store = new MemoryStore();
    const settings = { ...DEFAULT_SETTINGS, frameRatio: 16 / 9, snapRatios: false };

    await saveSettings(store, settings);

    expect(await loadSettings(store)).toEqual(settings);
  });

  it('caps history on save even if the caller sends more', async () => {
    const store = new MemoryStore();
    const many = Array.from({ length: MAX_HISTORY + 3 }, (_, index) => makeUploadEntry(index));

    await saveHistory(store, many);

    expect(await loadHistory(store)).toHaveLength(MAX_HISTORY);
  });

  it('clears the token by saving an empty one', async () => {
    const store = new MemoryStore();
    await saveSettings(store, { ...DEFAULT_SETTINGS, token: 'abc' });
    await saveSettings(store, { ...DEFAULT_SETTINGS, token: '' });

    expect((await loadSettings(store)).token).toBe('');
  });
});
