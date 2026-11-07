import type { ExportFileFormat } from './export';

/** File name from the Source stem, preset, local timestamp and format. Pure so it can be tested. */
export function exportFileName(
  sourceName: string,
  frameId: string,
  date: Date,
  extension: ExportFileFormat = 'png',
): string {
  const stem =
    sourceName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'source';
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${stem}-${frameId}-${stamp}.${extension}`;
}

/**
 * The automatic Image Chest Post title: the Source name without its extension,
 * followed by the Export's dimensions.
 */
export function postTitle(sourceName: string, width: number, height: number): string {
  const stem = sourceName.replace(/\.[^.]+$/, '').trim() || 'source';
  return `${stem} · ${width}×${height}`;
}
