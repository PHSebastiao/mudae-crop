import type { ExportFileFormat } from './export';

/** File name from the Source stem, Frame proportion slug, local timestamp and format. */
export function exportFileName(
  sourceName: string,
  slug: string,
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
  return `${stem}-${slug}-${stamp}.${extension}`;
}

/** The credit line written into an uploaded image's description when enabled. */
export const UPLOAD_CREDIT =
  'Cropped with [Mudae Crop](https://github.com/PHSebastiao/mudae-crop/)';

/**
 * The automatic Image Chest Post title: the Source name without its extension,
 * followed by the Export's dimensions.
 */
export function postTitle(sourceName: string, width: number, height: number): string {
  const stem = sourceName.replace(/\.[^.]+$/, '').trim() || 'source';
  return `${stem} · ${width}×${height}`;
}
