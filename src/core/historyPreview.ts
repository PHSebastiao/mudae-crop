import { MAX_DOWNLOAD_BYTES } from './download';
import type { ExportEntry, HistoryFormat } from './history';

/**
 * Reads a saved Export from disk. The platform supplies this: the file lives
 * wherever the save dialog wrote it, outside the web root, so a native command
 * hands the bytes over. Tests use a fake reader.
 */
export type PreviewReader = (path: string) => Promise<Uint8Array>;

/**
 * Turns Export bytes into something an `<img>` can show. The platform layer
 * owns object URLs; the core never touches a DOM API.
 */
export interface HistoryPreviewAdapter {
  createUrl(bytes: Uint8Array, format: HistoryFormat): string;
  revokeUrl(url: string): void;
}

export interface HistoryPreviewOptions {
  readonly read: PreviewReader;
  readonly adapter: HistoryPreviewAdapter;
  /** Overridable for tests; the product ceiling is MAX_DOWNLOAD_BYTES. */
  readonly maxBytes?: number;
}

export type HistoryPreviewErrorCode = 'unreadable' | 'too-large';

export class HistoryPreviewError extends Error {
  readonly code: HistoryPreviewErrorCode;

  constructor(code: HistoryPreviewErrorCode, message: string) {
    super(message);
    this.name = 'HistoryPreviewError';
    this.code = code;
  }
}

export interface HistoryPreviewLoader {
  /** Resolve the preview URL for an Export row. Repeat loads reuse the read. */
  load(entry: ExportEntry): Promise<string>;
  /** Keep only these rows' URLs, so a cleared or evicted entry leaks nothing. */
  retain(entries: readonly ExportEntry[]): void;
}

/**
 * The thumbnail cache is keyed by path and size: a re-render, a remount or a
 * second row for the same file reuses one read, and a file replaced with a
 * different size is read again. Failed reads are not cached, so a later mount
 * retries instead of pinning the fallback chip forever.
 */
function previewKey(entry: Pick<ExportEntry, 'path' | 'size'>): string {
  return `${entry.path}\u0000${entry.size}`;
}

interface CachedPreview {
  readonly promise: Promise<string>;
  /** Identifies the request that may still own its URL after a read resolves. */
  readonly token: object;
}

export function createHistoryPreviewLoader(options: HistoryPreviewOptions): HistoryPreviewLoader {
  const { read, adapter } = options;
  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const cache = new Map<string, CachedPreview>();

  const forget = (key: string) => {
    const cached = cache.get(key);
    if (!cached) return;
    cache.delete(key);
    void cached.promise.then(
      (url) => adapter.revokeUrl(url),
      () => undefined,
    );
  };

  const load = (entry: ExportEntry): Promise<string> => {
    const key = previewKey(entry);
    const hit = cache.get(key);
    if (hit) return hit.promise;

    const token = {};
    const request = (async (): Promise<string> => {
      let bytes: Uint8Array;
      try {
        bytes = await read(entry.path);
      } catch (reason) {
        const detail = reason instanceof Error && reason.message ? ` ${reason.message}` : '';
        throw new HistoryPreviewError('unreadable', `Não foi possível ler o Export.${detail}`);
      }
      if (bytes.length > maxBytes) {
        throw new HistoryPreviewError(
          'too-large',
          'O arquivo do Export é grande demais para a prévia.',
        );
      }
      const url = adapter.createUrl(bytes, entry.format);
      // The History may have cleared this row while the read was in flight.
      // Only the request still registered for this key may own the URL.
      if (cache.get(key)?.token !== token) {
        adapter.revokeUrl(url);
        throw new HistoryPreviewError('unreadable', 'O Export saiu do Histórico.');
      }
      return url;
    })();

    const cached = { promise: request, token };
    cache.set(key, cached);
    request.catch(() => {
      if (cache.get(key) === cached) cache.delete(key);
    });
    return request;
  };

  const retain = (entries: readonly ExportEntry[]) => {
    const keep = new Set(entries.map(previewKey));
    for (const key of [...cache.keys()]) {
      if (!keep.has(key)) forget(key);
    }
  };

  return { load, retain };
}
