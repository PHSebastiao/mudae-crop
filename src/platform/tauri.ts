import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';

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
