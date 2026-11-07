import { isImageChestLink } from './imagechest';
import { asRecord, parseJson } from './json';

export const MAX_UPLOAD_HISTORY = 50;

export type UploadFormat = 'png' | 'jpg' | 'gif';

export interface UploadRecord {
  readonly link: string;
  readonly postId: string;
  readonly imageId: string;
  readonly title: string;
  readonly format: UploadFormat;
  readonly size: number;
  /** ISO timestamp. */
  readonly uploadedAt: string;
}

function readRecord(value: unknown): UploadRecord | null {
  const data = asRecord(value);
  if (!data) return null;

  const link = typeof data.link === 'string' ? data.link : '';
  if (!isImageChestLink(link)) return null;
  const postId = typeof data.postId === 'string' ? data.postId : '';
  if (!postId) return null;
  const imageId = typeof data.imageId === 'string' ? data.imageId : '';
  const title = typeof data.title === 'string' ? data.title : '';
  const format =
    data.format === 'jpg' || data.format === 'gif' || data.format === 'png'
      ? data.format
      : 'png';
  const size = typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : 0;
  const uploadedAt = typeof data.uploadedAt === 'string' ? data.uploadedAt : '';
  if (Number.isNaN(new Date(uploadedAt).getTime())) return null;

  return { link, postId, imageId, title, format, size, uploadedAt };
}

function cap(records: readonly UploadRecord[]): UploadRecord[] {
  return records.slice(0, MAX_UPLOAD_HISTORY);
}

/** Newest first, capped. The newest upload is the one the user just made. */
export function appendUpload(
  records: readonly UploadRecord[],
  record: UploadRecord,
): UploadRecord[] {
  return cap([record, ...records]);
}

export function parseHistory(raw: string | null | undefined): UploadRecord[] {
  if (!raw) return [];
  const payload = parseJson(raw);
  if (!Array.isArray(payload)) return [];
  const records: UploadRecord[] = [];
  for (const item of payload) {
    const record = readRecord(item);
    if (record) records.push(record);
    if (records.length >= MAX_UPLOAD_HISTORY) break;
  }
  return records;
}

export function serializeHistory(records: readonly UploadRecord[]): string {
  return `${JSON.stringify(cap(records), null, 2)}\n`;
}

export function formatUploadDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
