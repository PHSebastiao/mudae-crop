/**
 * Image Chest's per-file ceiling. Download, upload and the optimize target cap
 * all share it so the app never offers a file the upload would refuse.
 */
export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;
