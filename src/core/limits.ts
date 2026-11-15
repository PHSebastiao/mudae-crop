/**
 * The size and batch ceilings shared by import, Export and Upload.
 */

/**
 * Image Chest's per-file ceiling for an upload. The API docs say 20 MB, while
 * the app's own download and Optimize ceilings are larger; a file above this
 * is refused before the request, so one oversized Tile cannot sink a batch.
 */
export const MAX_UPLOAD_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Image Chest's per-request ceiling. The docs: "Files per request: up to 20,
 * or 200 with Gold." A Gold check that turns out to be wrong is caught by the
 * first refused request, which demotes the account back to the standard size.
 */
export const UPLOAD_BATCH_STANDARD = 20;
export const UPLOAD_BATCH_GOLD = 200;

/** How many files one request may carry for this account. */
export function uploadBatchSize(gold: boolean | null | undefined): number {
  return gold === true ? UPLOAD_BATCH_GOLD : UPLOAD_BATCH_STANDARD;
}

/**
 * The per-file ceiling for a download and for the Optimize target: the app's
 * own bound, not the upload one.
 */
export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
