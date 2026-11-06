import { describe, expect, it } from 'vitest';
import { exportFileName } from '../src/core/naming';

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
});
