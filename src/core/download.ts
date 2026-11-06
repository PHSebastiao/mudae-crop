import type { ImageFormat } from './document';
import { detectFormat, type SourceCandidate } from './import';

/**
 * Image Chest accepts 30 MB per file, so a Source from a URL may not be larger
 * than that. The native transport enforces the same ceiling while streaming.
 */
export const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

export type DownloadErrorCode =
  | 'invalid-url'
  | 'unreachable'
  | 'http'
  | 'not-image'
  | 'empty'
  | 'too-large'
  | 'cancelled';

export class DownloadError extends Error {
  readonly code: DownloadErrorCode;
  readonly status: number | null;

  constructor(code: DownloadErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.status = status;
  }
}

export type DownloadFailureCode = 'unreachable' | 'http' | 'too-large' | 'cancelled';

/**
 * What a transport rejects with. The native layer maps its own failures onto
 * these codes so the wrapper can produce the wording without knowing reqwest.
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

const SIZE_MESSAGE = 'O download passa de 30 MB. Use um arquivo menor ou otimize o GIF antes.';

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

const KNOWN_EXTENSION = /\.(png|jpe?g|gif)$/i;
const CONTENT_EXTENSION: Record<ImageFormat, string> = { png: 'png', jpg: 'jpg', gif: 'gif' };

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
  if (KNOWN_EXTENSION.test(name)) return name;
  const stem = name.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  return `${stem || 'link'}.${CONTENT_EXTENSION[format]}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[exponent]}`;
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

function httpMessage(url: URL, status: number): string {
  if (status === 404) return 'O link não existe (404). Confira o endereço.';
  if (status === 403) return `O servidor recusou o acesso (403) a ${hostOf(url)}.`;
  if (status === 0) return `O servidor não respondeu ao pedido para ${hostOf(url)}.`;
  return `O servidor respondeu ${status} para ${hostOf(url)}.`;
}

function notImageMessage(url: URL, type: string | null): string {
  return type
    ? `O link não aponta para uma imagem (${type}). Use um link direto para PNG, JPG ou GIF.`
    : `O link ${hostOf(url)} não devolveu um PNG, JPG ou GIF. Use um link direto para a imagem.`;
}

function asDownloadError(reason: unknown, url: URL): DownloadError {
  if (reason instanceof DownloadError) return reason;
  if (reason instanceof DownloadTransportError) {
    switch (reason.code) {
      case 'cancelled':
        return new DownloadError('cancelled', 'Download cancelado.');
      case 'too-large':
        return new DownloadError('too-large', SIZE_MESSAGE);
      case 'http':
        return new DownloadError('http', httpMessage(url, reason.status ?? 0), reason.status);
      default:
        return new DownloadError(
          'unreachable',
          `Não foi possível alcançar ${hostOf(url)}. Verifique a conexão ou o link.`,
        );
    }
  }
  const detail = reason instanceof Error && reason.message ? ` ${reason.message}` : '';
  return new DownloadError(
    'unreachable',
    `Não foi possível baixar o link de ${hostOf(url)}.${detail}`,
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
    throw new DownloadError('invalid-url', 'O link precisa começar com http:// ou https://.');
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
      throw new DownloadError('cancelled', 'Download cancelado.');
    }
    if (oversized || result.bytes.length > maxBytes) {
      throw new DownloadError('too-large', SIZE_MESSAGE);
    }
    if (result.contentLength !== null && result.contentLength > maxBytes) {
      throw new DownloadError('too-large', SIZE_MESSAGE);
    }
    const type = contentTypeOf(result.contentType);
    if (!isImageContentType(type)) {
      throw new DownloadError('not-image', notImageMessage(url, type));
    }
    if (result.bytes.length === 0) {
      throw new DownloadError('empty', 'O link devolveu um arquivo vazio.');
    }
    const format = detectFormat(result.bytes);
    if (!format) {
      throw new DownloadError('not-image', notImageMessage(url, null));
    }
    return { name: sourceNameFromUrl(url, format), path: null, bytes: result.bytes };
  } catch (reason) {
    if (oversized) throw new DownloadError('too-large', SIZE_MESSAGE);
    if (cancelRequested) throw new DownloadError('cancelled', 'Download cancelado.');
    throw asDownloadError(reason, url);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function downloadErrorMessage(error: unknown): string {
  if (error instanceof DownloadError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível baixar essa imagem.';
}
