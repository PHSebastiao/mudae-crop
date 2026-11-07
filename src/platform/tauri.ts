import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  DownloadTransportError,
  type DownloadHandle,
  type DownloadMeta,
  type DownloadProgress,
  type DownloadResult,
  type DownloadTransport,
} from '../core/download';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif'];

export function isDesktop(): boolean {
  return isTauri();
}

export function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export async function chooseSourceFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: 'Abrir imagem',
    filters: [{ name: 'Imagens', extensions: IMAGE_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

export async function chooseExportPath(defaultPath: string): Promise<string | null> {
  const selected = await save({
    title: 'Exportar PNG',
    defaultPath,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  return selected ?? null;
}

/** Pick the folder the Export save dialog should open in next time. */
export async function chooseExportFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Pasta dos Exports',
  });
  return typeof selected === 'string' ? selected : null;
}

/** The folder part of a native path; empty when the path has no separator. */
export function folderOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index > 0 ? path.slice(0, index) : '';
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>('read_file_bytes', { path });
  return new Uint8Array(buffer);
}

export async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_file_bytes', { path, contents: Array.from(bytes) });
}

/**
 * Tauri delivers OS file drops with real paths. The callback receives them and
 * the caller reuses the same import path as the file dialog.
 */
export async function watchFileDrops(
  onDrop: (paths: string[]) => void,
): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  return getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === 'drop') {
      onDrop(event.payload.paths);
    }
  });
}

interface DownloadMetaPayload {
  readonly id: string;
  readonly contentType: string | null;
  readonly contentLength: number | null;
  readonly finalUrl: string;
}

interface DownloadProgressPayload {
  readonly id: string;
  readonly received: number;
  readonly total: number | null;
}

function transportError(reason: unknown): DownloadTransportError {
  const failure = reason as { code?: unknown; status?: unknown; detail?: unknown } | null;
  if (failure && typeof failure.code === 'string') {
    const { code } = failure;
    if (code === 'unreachable' || code === 'http' || code === 'too-large' || code === 'cancelled') {
      const status = typeof failure.status === 'number' ? failure.status : null;
      const detail = typeof failure.detail === 'string' ? failure.detail : code;
      return new DownloadTransportError(code, detail, status);
    }
  }
  return new DownloadTransportError(
    'unreachable',
    typeof reason === 'string' ? reason : 'falha de rede',
  );
}

let downloadSequence = 0;

/**
 * The native URL transport. Progress and metadata arrive as events, the body
 * comes back as a raw response, and cancel flips a flag on the Rust side.
 */
export const tauriDownloadTransport: DownloadTransport = {
  start(url: string, onProgress: (progress: DownloadProgress) => void): DownloadHandle {
    const id = `source-${Date.now()}-${++downloadSequence}`;
    let settled = false;
    let cancelled = false;

    const cancel = () => {
      if (settled) return;
      cancelled = true;
      void invoke('cancel_download', { download_id: id }).catch(() => undefined);
    };

    const result = (async (): Promise<DownloadResult> => {
      let meta: DownloadMeta = { contentType: null, contentLength: null, finalUrl: url };
      const listeners = await Promise.all([
        listen<DownloadMetaPayload>('download-meta', (event) => {
          if (event.payload.id !== id) return;
          meta = {
            contentType: event.payload.contentType,
            contentLength: event.payload.contentLength,
            finalUrl: event.payload.finalUrl,
          };
        }),
        listen<DownloadProgressPayload>('download-progress', (event) => {
          if (event.payload.id !== id) return;
          onProgress({ received: event.payload.received, total: event.payload.total });
        }),
      ]);

      try {
        if (cancelled) throw new DownloadTransportError('cancelled', 'cancelado');
        const buffer = await invoke<ArrayBuffer>('download_source', {
          url,
          download_id: id,
        });
        return { bytes: new Uint8Array(buffer), ...meta };
      } catch (reason) {
        throw transportError(reason);
      } finally {
        settled = true;
        for (const stop of listeners) stop();
      }
    })();

    return { result, cancel };
  },
};
