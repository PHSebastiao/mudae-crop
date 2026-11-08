import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY,
  appendHistory,
  formatHistoryDate,
  parseHistory,
  serializeHistory,
  type HistoryEntry,
} from '../src/core/history';
import { makeExportEntry, makeUploadEntry } from './helpers';

describe('history', () => {
  it('starts empty for missing or corrupt files', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{oops')).toEqual([]);
    expect(parseHistory('{"uploads": []}')).toEqual([]);
  });

  it('keeps well-formed upload and export entries', () => {
    const raw = JSON.stringify([
      makeUploadEntry(1),
      makeExportEntry(2),
      { link: 'not-a-link', postId: 'x', kind: 'upload' },
      { ...makeExportEntry(3), path: '' },
      { ...makeExportEntry(4), width: 0 },
      null,
    ]);

    const entries = parseHistory(raw);

    expect(entries.map((entry) => entry.kind)).toEqual(['upload', 'export']);
    expect(entries.map((entry) => entry.title)).toEqual([
      makeUploadEntry(1).title,
      makeExportEntry(2).title,
    ]);
  });

  it('drops an unknown entry kind', () => {
    expect(parseHistory(JSON.stringify([{ ...makeUploadEntry(1), kind: 'gif' }]))).toEqual([]);
  });

  it('drops an entry without a kind', () => {
    const entry = { ...makeUploadEntry(1) } as Record<string, unknown>;
    delete entry.kind;

    expect(parseHistory(JSON.stringify([entry]))).toEqual([]);
  });

  it('puts the newest entry first and caps the list at 50', () => {
    let history: HistoryEntry[] = [];
    for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
      history = appendHistory(
        history,
        index % 2 === 0 ? makeUploadEntry(index) : makeExportEntry(index),
      );
    }

    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0].createdAt).toBe(makeUploadEntry(MAX_HISTORY + 4).createdAt);
    expect(history[history.length - 1].createdAt).toBe(makeExportEntry(5).createdAt);
  });

  it('round-trips through serialize and parse', () => {
    const history = appendHistory(appendHistory([], makeUploadEntry(1)), makeExportEntry(2));

    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  it('keeps the GIF format of an uploaded animation', () => {
    const gif = makeUploadEntry(1, {
      format: 'gif',
      link: 'https://cdn.imgchest.com/files/motion.gif',
    });

    const [entry] = parseHistory(serializeHistory([gif]));

    expect(entry).toMatchObject({ kind: 'upload', format: 'gif' });
  });

  it('formats a valid date and ignores an invalid one', () => {
    expect(formatHistoryDate('not a date')).toBe('');
    expect(formatHistoryDate(makeUploadEntry(1).createdAt)).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });
});
