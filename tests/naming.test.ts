import { describe, expect, it } from 'vitest';
import { exportFileName, postTitle } from '../src/core/naming';

const date = new Date(2026, 10, 6, 14, 5, 9);

describe('Export file names', () => {
  it('combines the Source stem, preset and timestamp', () => {
    expect(exportFileName('My Card.PNG', 'mudae', date)).toBe('my-card-mudae-20261106-140509.png');
  });

  it('falls back to source when the stem has no usable characters', () => {
    expect(exportFileName('✨✨.png', 'mudae', date)).toBe('source-mudae-20261106-140509.png');
  });

  it('never uses separators from a Windows path', () => {
    expect(exportFileName('C:\\art\\Waifu 01.jpg', 'mudae', date)).toBe(
      'c-art-waifu-01-mudae-20261106-140509.png',
    );
  });

  it('uses the GIF extension for an animated Export', () => {
    expect(exportFileName('Loop.GIF', 'mudae', date, 'gif')).toBe('loop-mudae-20261106-140509.gif');
  });
});

describe('Post titles', () => {
  it('follows <source name> · <width>×<height>', () => {
    expect(postTitle('waifu.png', 225, 350)).toBe('waifu · 225×350');
  });

  it('drops only the final extension and keeps the user casing', () => {
    expect(postTitle('My.Card.GIF', 350, 320)).toBe('My.Card · 350×320');
    expect(postTitle('no-extension', 225, 350)).toBe('no-extension · 225×350');
  });

  it('falls back to source when the name is empty', () => {
    expect(postTitle('', 225, 350)).toBe('source · 225×350');
  });
});
