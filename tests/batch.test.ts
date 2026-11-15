import { describe, expect, it } from 'vitest';
import {
  chunkItems,
  freeFileName,
  groupPostTitle,
  joinLinks,
  partitionBySize,
  shouldDemoteGold,
} from '../src/core/batch';
import { UPLOAD_BATCH_GOLD, UPLOAD_BATCH_STANDARD, uploadBatchSize } from '../src/core/limits';

describe('chunkItems', () => {
  it('splits into full chunks and a smaller tail', () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkItems([], 20)).toEqual([]);
  });

  it('never asks for an empty chunk size', () => {
    expect(chunkItems([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunkItems([1, 2], 1.9)).toEqual([[1], [2]]);
  });
});

describe('joinLinks', () => {
  it('joins the links with a bare dollar sign', () => {
    expect(joinLinks(['a', 'b', 'c'])).toBe('a$b$c');
  });

  it('drops empty links', () => {
    expect(joinLinks(['a', '', '  ', 'b'])).toBe('a$b');
    expect(joinLinks([])).toBe('');
  });
});

describe('groupPostTitle', () => {
  it('keeps a single Tile title untouched', () => {
    expect(groupPostTitle('cat · 225×350', 1)).toBe('cat · 225×350');
  });

  it('names the extra images a grouped Post holds', () => {
    expect(groupPostTitle('cat · 225×350', 3)).toBe('cat · 225×350 +2');
  });
});

describe('uploadBatchSize', () => {
  it('uses 20 for standard and unknown accounts, 200 for Gold', () => {
    expect(uploadBatchSize(true)).toBe(UPLOAD_BATCH_GOLD);
    expect(uploadBatchSize(false)).toBe(UPLOAD_BATCH_STANDARD);
    expect(uploadBatchSize(null)).toBe(UPLOAD_BATCH_STANDARD);
    expect(uploadBatchSize(undefined)).toBe(UPLOAD_BATCH_STANDARD);
  });
});

describe('partitionBySize', () => {
  const items = [
    { name: 'small', size: 10 },
    { name: 'edge', size: 20 },
    { name: 'big', size: 21 },
  ];

  it('splits by the per-file ceiling without dropping anything', () => {
    const { ok, tooLarge } = partitionBySize(items, (item) => item.size, 20);
    expect(ok.map((item) => item.name)).toEqual(['small', 'edge']);
    expect(tooLarge.map((item) => item.name)).toEqual(['big']);
  });

  it('keeps everything when nothing is over the ceiling', () => {
    const { ok, tooLarge } = partitionBySize(items, (item) => item.size, 1000);
    expect(ok).toHaveLength(3);
    expect(tooLarge).toHaveLength(0);
  });
});

describe('shouldDemoteGold', () => {
  it('demotes a Gold account only for a refused request size', () => {
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'server', status: 422 })).toBe(true);
    expect(shouldDemoteGold({ gold: true, chunkSize: 200, code: 'server', status: 400 })).toBe(
      true,
    );
  });

  it('never demotes for a bad Post, a 404, a per-file error or a small chunk', () => {
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'invalid-post', status: 403 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'server', status: 404 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'server', status: 500 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'too-large', status: 413 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: 'rate-limited', status: 429 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: true, chunkSize: 21, code: null, status: null })).toBe(false);
    expect(shouldDemoteGold({ gold: true, chunkSize: 20, code: 'server', status: 422 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: false, chunkSize: 200, code: 'server', status: 422 })).toBe(
      false,
    );
    expect(shouldDemoteGold({ gold: null, chunkSize: 200, code: 'server', status: 422 })).toBe(
      false,
    );
  });
});

describe('freeFileName', () => {
  it('walks -2, -3… until a name is free', async () => {
    const taken = new Set(['card.png', 'card-2.png']);
    const name = await freeFileName('card.png', 'png', async (candidate) => taken.has(candidate));
    expect(name).toBe('card-3.png');
  });

  it('throws instead of returning a taken name', async () => {
    await expect(freeFileName('card.png', 'png', async () => true)).rejects.toThrow(/nome livre/);
  });
});
