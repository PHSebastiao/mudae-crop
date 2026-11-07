import { invoke, isTauri } from '@tauri-apps/api/core';
import type { HistoryPreviewAdapter, PreviewReader } from '../core/historyPreview';
import { blobOf } from './browser';

/**
 * A saved Export lives outside the web root, so the bytes come through the
 * native command. The browser dev build has no file to read and falls back to
 * the chip like a moved file.
 */
export const readExportBytes: PreviewReader = async (path: string): Promise<Uint8Array> => {
  if (!isTauri()) {
    throw new Error('a prévia do Export só funciona no app desktop');
  }
  const buffer = await invoke<ArrayBuffer>('read_export_bytes', { path });
  return new Uint8Array(buffer);
};

/** Object URLs are the platform's; the core only asks for a viewable string. */
export const historyPreviewAdapter: HistoryPreviewAdapter = {
  createUrl(bytes, format) {
    return URL.createObjectURL(blobOf(bytes, format));
  },
  revokeUrl(url) {
    URL.revokeObjectURL(url);
  },
};
