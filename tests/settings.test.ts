import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  type Settings,
} from '../src/core/settings';

describe('settings', () => {
  it('falls back to the defaults when there is nothing saved', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
  });

  it('survives corrupt JSON without throwing', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips the token, folder and defaults it was given', () => {
    const settings: Settings = {
      token: 'secret-token',
      defaultPrivacy: 'public',
      appendPostId: '3qe4gdvj4j2',
      saveFolder: 'C:\\Cards\\Exports',
      borderColor: '#AABBCC',
      borderWidth: 3,
      exportFormat: 'png',
      exportScale: 2,
    };

    const loaded = parseSettings(serializeSettings(settings));

    expect(loaded).toEqual(settings);
  });

  it('ignores invalid values field by field instead of discarding everything', () => {
    const loaded = parseSettings(
      JSON.stringify({
        token: ' kept ',
        defaultPrivacy: 'everyone',
        appendPostId: '../bad',
        saveFolder: '',
        borderColor: 'red',
        borderWidth: 99,
        exportFormat: 'bmp',
        exportScale: 3,
      }),
    );

    expect(loaded.token).toBe('kept');
    expect(loaded.defaultPrivacy).toBe(DEFAULT_SETTINGS.defaultPrivacy);
    expect(loaded.appendPostId).toBe('');
    expect(loaded.saveFolder).toBeNull();
    expect(loaded.borderColor).toBe(DEFAULT_SETTINGS.borderColor);
    expect(loaded.borderWidth).toBe(20);
    expect(loaded.exportFormat).toBe('png');
    expect(loaded.exportScale).toBe(1);
  });

  it('falls back a legacy JPG format to PNG', () => {
    expect(parseSettings(JSON.stringify({ exportFormat: 'jpg' })).exportFormat).toBe('png');
  });

  it('keeps a saved token empty when it was cleared', () => {
    const loaded = parseSettings(JSON.stringify({ ...DEFAULT_SETTINGS, token: '' }));

    expect(loaded.token).toBe('');
  });

  it('clamps a negative Border width to zero', () => {
    expect(parseSettings(JSON.stringify({ borderWidth: -4 })).borderWidth).toBe(0);
  });
});
