/**
 * The small pure pieces a batch command needs: how to split files into
 * requests, how the links are joined for Discord, and what a grouped Post is
 * called.
 */

import { UPLOAD_BATCH_STANDARD } from './limits';
import type { ImageChestErrorCode } from './imagechest';

/** Split a list into chunks of at most `size`; never returns an empty chunk. */
export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const limit = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    chunks.push(items.slice(index, index + limit));
  }
  return chunks;
}

/**
 * Split a list into what fits a per-file ceiling and what does not. A batch
 * checks every rendered file before the first request, so one oversized image
 * is a bad Tile instead of a failed Post.
 */
export function partitionBySize<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  limit: number,
): { readonly ok: T[]; readonly tooLarge: T[] } {
  const ok: T[] = [];
  const tooLarge: T[] = [];
  for (const item of items) {
    if (sizeOf(item) > limit) tooLarge.push(item);
    else ok.push(item);
  }
  return { ok, tooLarge };
}

/**
 * Whether a refused chunk is evidence that the stored account tier is wrong.
 * Only a validation refusal of the request itself counts: a bad Post id, a
 * per-file `too-large`, a rate limit or a 404 would fail the same way in a
 * 20-file chunk, so demoting the account for them would be a lie.
 */
export function shouldDemoteGold(input: {
  readonly gold: boolean | null;
  readonly chunkSize: number;
  readonly code: ImageChestErrorCode | null;
  readonly status: number | null;
}): boolean {
  if (input.gold !== true) return false;
  if (input.chunkSize <= UPLOAD_BATCH_STANDARD) return false;
  return (
    input.code === 'server' &&
    input.status !== null &&
    input.status >= 400 &&
    input.status < 500 &&
    input.status !== 404
  );
}

/**
 * The first free name for a file: the requested one, or `-2`, `-3`… when taken.
 * `exists` answers whether a candidate is taken. Throws instead of returning a
 * taken name: a batch Export promises never to overwrite.
 */
export async function freeFileName(
  name: string,
  extension: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const stem = name.replace(/\.[^.]+$/, '');
  for (let attempt = 1; attempt <= 99; attempt += 1) {
    const candidate = attempt === 1 ? name : `${stem}-${attempt}.${extension}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Não há nome livre para "${name}" nesta pasta.`);
}

/**
 * The clipboard format for a batch: every direct link joined by a bare `$`, no
 * spaces and no line breaks, so Mudae reads the whole set as one token.
 */
export function joinLinks(links: readonly string[]): string {
  return links.filter((link) => link.trim() !== '').join('$');
}

/**
 * The title of a Post that holds several Tiles: the first Tile's own title plus
 * the count, so the Post is still identifiable in the account's list.
 */
export function groupPostTitle(firstTitle: string, count: number): string {
  if (count <= 1) return firstTitle;
  return `${firstTitle} +${count - 1}`;
}
