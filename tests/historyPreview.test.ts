import { describe, expect, it, vi } from 'vitest';
import {
  HistoryPreviewError,
  createHistoryPreviewLoader,
  type HistoryPreviewAdapter,
} from '../src/core/historyPreview';
import { makeExportEntry } from './helpers';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fakeAdapter() {
  const created: string[] = [];
  const revoked: string[] = [];
  const adapter: HistoryPreviewAdapter = {
    createUrl: () => {
      const url = `blob:preview-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
  };
  return { adapter, created, revoked };
}

describe('history preview', () => {
  it('turns a saved Export into a preview URL', async () => {
    const entry = makeExportEntry(1);
    const read = vi.fn(async () => PNG_BYTES);
    const { adapter, created } = fakeAdapter();
    const loader = createHistoryPreviewLoader({ read, adapter });

    const url = await loader.load(entry);

    expect(url).toBe(created[0]);
    expect(read).toHaveBeenCalledWith(entry.path);
  });

  it('rejects when the file is gone, so the row can fall back to the chip', async () => {
    const read = vi.fn(async () => {
      throw new Error('não existe');
    });
    const loader = createHistoryPreviewLoader({ read, adapter: fakeAdapter().adapter });

    const failure = loader.load(makeExportEntry(1));

    await expect(failure).rejects.toBeInstanceOf(HistoryPreviewError);
    await expect(failure).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('rejects an Export over the size ceiling without making a URL', async () => {
    const read = vi.fn(async () => PNG_BYTES);
    const { adapter, created } = fakeAdapter();
    const loader = createHistoryPreviewLoader({ read, adapter, maxBytes: 4 });

    await expect(loader.load(makeExportEntry(1))).rejects.toMatchObject({ code: 'too-large' });
    expect(created).toEqual([]);
  });

  it('reads each path and size once, even across equivalent entries', async () => {
    const entry = makeExportEntry(7);
    const read = vi.fn(async () => PNG_BYTES);
    const { adapter, created } = fakeAdapter();
    const loader = createHistoryPreviewLoader({ read, adapter });

    const first = loader.load(entry);
    const second = loader.load({ ...entry, fileName: 'renamed.png' });
    const url = await first;

    expect(second).toBe(first);
    expect(url).toBe(created[0]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('revokes the URL when the entry leaves the History', async () => {
    const entry = makeExportEntry(3);
    const read = vi.fn(async () => PNG_BYTES);
    const { adapter, revoked } = fakeAdapter();
    const loader = createHistoryPreviewLoader({ read, adapter });

    const url = await loader.load(entry);
    loader.retain([]);
    await Promise.resolve();

    expect(revoked).toEqual([url]);
  });
});
