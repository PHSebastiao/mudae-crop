import type { ImageFormat } from './document';
import { detectFormat, type SourceCandidate } from './import';
import { MAX_MEDIA_BYTES } from './limits';
import { text, textOf, type TextRef } from './i18n/text';

/**
 * The download ceiling matches Image Chest's 30 MB per-file limit, so a fetched
 * Source never exceeds what the upload path accepts. The native transport
 * enforces the same ceiling while streaming.
 */
export const MAX_DOWNLOAD_BYTES = MAX_MEDIA_BYTES;

export type DownloadErrorCode =
  'invalid-url' | 'unreachable' | 'http' | 'not-image' | 'empty' | 'too-large' | 'cancelled';

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;
  readonly text: TextRef;
  readonly status: number | null;

  constructor(code: DownloadErrorCode, message: TextRef, status: number | null = null) {
    super(message.key);
    this.name = 'DownloadError';
    this.code = code;
    this.text = message;
    this.status = status;
  }
}

export type DownloadFailureCode = 'unreachable' | 'http' | 'too-large' | 'cancelled';

/**
 * What a transport rejects with. It carries a code and a native detail, not a
 * key: `asDownloadError` maps the code to the user-facing message, so this
 * class never reaches the screen.
 */
export class DownloadTransportError extends Error {
  readonly code: DownloadFailureCode;
  readonly status: number | null;

  constructor(code: DownloadFailureCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'DownloadTransportError';
    this.code = code;
    this.status = status;
  }
}

export interface DownloadProgress {
  readonly received: number;
  readonly total: number | null;
}

export interface DownloadMeta {
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly finalUrl: string;
}

export interface DownloadResult extends DownloadMeta {
  readonly bytes: Uint8Array;
}

export interface DownloadHandle {
  readonly result: Promise<DownloadResult>;
  cancel(): void;
}

/**
 * The seam between the wrapper and the native download. Tests use a fake
 * transport; the app uses the Tauri command.
 */
export interface DownloadTransport {
  start(url: string, onProgress: (progress: DownloadProgress) => void): DownloadHandle;
}

export interface DownloadOptions {
  readonly transport: DownloadTransport;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DownloadProgress) => void;
  /** Overridable for tests; the product ceiling is MAX_DOWNLOAD_BYTES. */
  readonly maxBytes?: number;
}

function hostOf(url: URL): string {
  return url.host || url.href;
}

/**
 * Read a URL from clipboard text. Only a bare http(s) link counts, optionally
 * wrapped in angle brackets the way Discord shows it.
 */
export function sourceUrlFrom(text: string): URL | null {
  const cleaned = text.trim().replace(/^<+/, '').replace(/>+$/, '').trim();
  if (!cleaned || /\s/.test(cleaned) || !/^https?:\/\//i.test(cleaned)) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

const KNOWN_EXTENSION = /\.(png|jpe?g|gif|webp|apng|mp4|m4v|mov|webm)$/i;
const CONTENT_EXTENSION: Record<ImageFormat, string> = {
  png: 'png',
  jpg: 'jpg',
  gif: 'gif',
  webp: 'webp',
  apng: 'png',
  mp4: 'mp4',
  mov: 'mov',
  webm: 'webm',
};
const FORMAT_EXTENSIONS: Record<ImageFormat, string[]> = {
  png: ['png'],
  jpg: ['jpg', 'jpeg'],
  gif: ['gif'],
  webp: ['webp'],
  apng: ['png', 'apng'],
  mp4: ['mp4', 'm4v'],
  mov: ['mov'],
  webm: ['webm'],
};

/**
 * A name for the Source taken from the last path segment. Query strings and
 * fragments never leak into the name, and an unknown extension is replaced so
 * the Export keeps a sensible stem.
 */
export function sourceNameFromUrl(url: URL, format: ImageFormat): string {
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // A malformed escape stays as-is; the sanitising below still applies.
  }
  name = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (!name) return `link.${CONTENT_EXTENSION[format]}`;
  if (KNOWN_EXTENSION.test(name)) {
    const extension = (name.split('.').pop() ?? '').toLowerCase();
    // Keep the name only when its extension matches what the bytes turned out to be.
    if (FORMAT_EXTENSIONS[format].includes(extension)) return name;
    return `${name.replace(/\.[^.]+$/, '')}.${CONTENT_EXTENSION[format]}`;
  }
  const stem = name.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  return `${stem || 'link'}.${CONTENT_EXTENSION[format]}`;
}

function contentTypeOf(value: string | null): string | null {
  if (!value) return null;
  const type = value.split(';')[0].trim().toLowerCase();
  return type || null;
}

function isImageContentType(type: string | null): boolean {
  if (!type) return true;
  return (
    type.startsWith('image/') ||
    type === 'application/octet-stream' ||
    type === 'binary/octet-stream'
  );
}

function httpMessage(url: URL, status: number): TextRef {
  if (status === 404) return text('download.notFound');
  if (status === 403) return text('download.forbidden', { host: hostOf(url) });
  if (status === 0) return text('download.noResponse', { host: hostOf(url) });
  return text('download.httpStatus', { status, host: hostOf(url) });
}

function notImageMessage(url: URL, type: string | null): TextRef {
  return type
    ? text('download.notImageType', { type })
    : text('download.notImageHost', { host: hostOf(url) });
}

function cancelledError(): DownloadError {
  return new DownloadError('cancelled', text('download.cancelled'));
}

function tooLargeError(): DownloadError {
  return new DownloadError('too-large', text('download.tooLarge'));
}

function asDownloadError(reason: unknown, url: URL): DownloadError {
  if (reason instanceof DownloadError) return reason;
  if (reason instanceof DownloadTransportError) {
    switch (reason.code) {
      case 'cancelled':
        return cancelledError();
      case 'too-large':
        return tooLargeError();
      case 'http':
        return new DownloadError('http', httpMessage(url, reason.status ?? 0), reason.status);
      default:
        return new DownloadError(
          'unreachable',
          text('download.unreachable', { host: hostOf(url) }),
        );
    }
  }
  const detail =
    textOf(reason) ??
    (reason instanceof Error && reason.message ? reason.message : text('common.unknownCause'));
  return new DownloadError(
    'unreachable',
    text('download.failedHost', { host: hostOf(url), detail }),
  );
}

/**
 * Download a link into a Source candidate. Failures are DownloadError values
 * with a message the notice bar can show; nothing is decoded here, so an
 * oversized or non-image response never touches the decoder.
 */
export async function downloadSource(
  rawUrl: string,
  options: DownloadOptions,
): Promise<SourceCandidate> {
  const url = sourceUrlFrom(rawUrl);
  if (!url) {
    throw new DownloadError('invalid-url', text('download.invalidUrl'));
  }

  const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES;
  let handle: DownloadHandle | null = null;
  let oversized = false;
  let cancelRequested = false;

  const cancel = () => {
    cancelRequested = true;
    handle?.cancel();
  };

  const rejectForSize = () => {
    if (oversized) return;
    oversized = true;
    // handle is assigned as soon as start() returns, so cancelling from a
    // microtask also works when a fake transport reports progress synchronously.
    queueMicrotask(() => handle?.cancel());
  };

  const onProgress = (progress: DownloadProgress) => {
    options.onProgress?.(progress);
    if (progress.total !== null && progress.total > maxBytes) rejectForSize();
    if (progress.received > maxBytes) rejectForSize();
  };

  handle = options.transport.start(url.href, onProgress);

  const onAbort = () => cancel();
  if (options.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const result = await handle.result;
    if (cancelRequested) {
      throw cancelledError();
    }
    if (oversized || result.bytes.length > maxBytes) {
      throw tooLargeError();
    }
    if (result.contentLength !== null && result.contentLength > maxBytes) {
      throw tooLargeError();
    }
    const type = contentTypeOf(result.contentType);
    if (!isImageContentType(type)) {
      throw new DownloadError('not-image', notImageMessage(url, type));
    }
    if (result.bytes.length === 0) {
      throw new DownloadError('empty', text('download.empty'));
    }
    const format = detectFormat(result.bytes);
    if (!format) {
      throw new DownloadError('not-image', notImageMessage(url, null));
    }
    // Redirects often land on the real file, so the final URL names the Source.
    return {
      name: sourceNameFromUrl(sourceUrlFrom(result.finalUrl) ?? url, format),
      path: null,
      bytes: result.bytes,
    };
  } catch (reason) {
    if (oversized) throw tooLargeError();
    if (cancelRequested) throw cancelledError();
    throw asDownloadError(reason, url);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function downloadErrorMessage(error: unknown): TextRef {
  const keyed = textOf(error);
  if (keyed) return keyed;
  return text('download.failed');
}
