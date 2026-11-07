import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_HISTORY,
  appendUpload,
  formatUploadDate,
  parseHistory,
  serializeHistory,
  type UploadRecord,
} from '../src/core/history';
import { makeUploadRecord } from './helpers';

describe('upload history', () => {
  it('starts empty for missing or corrupt files', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{oops')).toEqual([]);
    expect(parseHistory('{"uploads": []}')).toEqual([]);
  });

  it('keeps only well-formed upload records', () => {
    const raw = JSON.stringify([
      makeUploadRecord(1),
      { link: 'not-a-link', postId: 'x' },
      { ...makeUploadRecord(2), uploadedAt: 'yesterday' },
      null,
    ]);

    const loaded = parseHistory(raw);

    expect(loaded.map((item) => item.imageId)).toEqual(['image1']);
  });

  it('puts the newest upload first and caps the list at 50', () => {
    let history: UploadRecord[] = [];
    for (let index = 0; index < MAX_UPLOAD_HISTORY + 5; index += 1) {
      history = appendUpload(history, makeUploadRecord(index));
    }

    expect(history).toHaveLength(MAX_UPLOAD_HISTORY);
    expect(history[0].imageId).toBe(`image${MAX_UPLOAD_HISTORY + 4}`);
    expect(history[history.length - 1].imageId).toBe('image5');
  });

  it('round-trips through serialize and parse', () => {
    const history = appendUpload([], makeUploadRecord(1));

    expect(parseHistory(serializeHistory(history))).toEqual(history);
  });

  it('formats a valid date and ignores an invalid one', () => {
    expect(formatUploadDate('not a date')).toBe('');
    expect(formatUploadDate(makeUploadRecord(1).uploadedAt)).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/,
    );
  });
});
