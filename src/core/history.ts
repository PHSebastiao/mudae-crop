import { isImageChestLink } from './imagechest';
import { asRecord, parseJson } from './json';

export const MAX_HISTORY = 50;

export type HistoryFormat = 'png' | 'jpg' | 'gif';

interface HistoryEntryBase {
  /** The automatic Post title: `<source stem> · <width>×<height>`. */
  readonly title: string;
  readonly format: HistoryFormat;
  readonly size: number;
  /** ISO timestamp of the upload or of the local Export. */
  readonly createdAt: string;
}

export interface UploadEntry extends HistoryEntryBase {
  readonly kind: 'upload';
  readonly link: string;
  readonly postId: string;
  readonly imageId: string;
}

/**
 * A local Export recorded on save. `path` is the absolute file the native save
 * dialog returned, so the History can reveal it in Explorer later.
 */
export interface ExportEntry extends HistoryEntryBase {
  readonly kind: 'export';
  readonly path: string;
  readonly fileName: string;
  readonly width: number;
  readonly height: number;
}

export type HistoryEntry = UploadEntry | ExportEntry;

function asFormat(value: unknown): HistoryFormat {
  return value === 'jpg' || value === 'gif' || value === 'png' ? value : 'png';
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function readBase(data: Record<string, unknown>): HistoryEntryBase | null {
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const size = typeof data.size === 'number' && Number.isFinite(data.size) ? data.size : 0;
  // Legacy records used `uploadedAt` and had no `kind`.
  const stamp =
    typeof data.createdAt === 'string'
      ? data.createdAt
      : typeof data.uploadedAt === 'string'
        ? data.uploadedAt
        : '';
  if (!title || Number.isNaN(new Date(stamp).getTime())) return null;
  return { title, format: asFormat(data.format), size, createdAt: stamp };
}

function readEntry(value: unknown): HistoryEntry | null {
  const data = asRecord(value);
  if (!data) return null;
  const base = readBase(data);
  if (!base) return null;

  if (data.kind === 'export') {
    const path = typeof data.path === 'string' ? data.path.trim() : '';
    if (!path) return null;
    const width = typeof data.width === 'number' && data.width > 0 ? data.width : 0;
    const height = typeof data.height === 'number' && data.height > 0 ? data.height : 0;
    if (!width || !height) return null;
    const fileName =
      typeof data.fileName === 'string' && data.fileName.trim()
        ? data.fileName.trim()
        : fileNameFromPath(path);
    return { ...base, kind: 'export', path, fileName, width, height };
  }

  // Missing `kind` is a legacy upload record; an unknown kind is dropped.
  if (data.kind !== undefined && data.kind !== 'upload') return null;
  const link = typeof data.link === 'string' ? data.link : '';
  if (!isImageChestLink(link)) return null;
  const postId = typeof data.postId === 'string' ? data.postId : '';
  if (!postId) return null;
  const imageId = typeof data.imageId === 'string' ? data.imageId : '';
  return { ...base, kind: 'upload', link, postId, imageId };
}

function cap(entries: readonly HistoryEntry[]): HistoryEntry[] {
  return entries.slice(0, MAX_HISTORY);
}

/** Newest first, capped. The newest event is the one the user just made. */
export function appendHistory(
  entries: readonly HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return cap([entry, ...entries]);
}

export function parseHistory(raw: string | null | undefined): HistoryEntry[] {
  if (!raw) return [];
  const payload = parseJson(raw);
  if (!Array.isArray(payload)) return [];
  const entries: HistoryEntry[] = [];
  for (const item of payload) {
    const entry = readEntry(item);
    if (entry) entries.push(entry);
    if (entries.length >= MAX_HISTORY) break;
  }
  return entries;
}

export function serializeHistory(entries: readonly HistoryEntry[]): string {
  return `${JSON.stringify(cap(entries), null, 2)}\n`;
}

export function formatHistoryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
