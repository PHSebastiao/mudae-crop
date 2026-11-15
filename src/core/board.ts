/**
 * The Board's layout math. Pure numbers so the fit, the zoom limits and the
 * row wrapping are testable without a DOM.
 *
 * Zoom is anchored at "fit all": zoom 1 shows every Tile inside the viewport,
 * and zooming in only makes the Board scroll. There is no separate fit mode.
 */

/** Space between Tiles, in CSS pixels. */
export const BOARD_GAP = 16;

/** Space around the whole Board, in CSS pixels. */
export const BOARD_PAD = 20;

/** The Tile header plus footer around the card, in CSS pixels. */
export const TILE_CHROME = 42;

/** A Tile never gets narrower than this, however many there are. */
export const MIN_TILE_WIDTH = 56;

/** Fit-all is the floor: zooming out past it would only add empty space. */
export const MIN_BOARD_ZOOM = 1;

export const MAX_BOARD_ZOOM = 6;

/** The exponent factor one wheel notch applies, shared by Preview and Board. */
export const BOARD_WHEEL_FACTOR = 0.0009;

export function clampBoardZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_BOARD_ZOOM;
  return Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, zoom));
}

/** The zoom after one wheel event; scrolling up zooms in. */
export function boardZoomAfterWheel(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return clampBoardZoom(zoom);
  return clampBoardZoom(zoom * Math.exp(-deltaY * BOARD_WHEEL_FACTOR));
}

/** The card height a Tile of `width` needs at `ratio` (width / height). */
export function tileCardHeight(width: number, ratio: number): number {
  if (!(width > 0) || !(ratio > 0)) return 0;
  return width / ratio;
}

/**
 * The widest Tile that still shows every Tile inside the viewport. Tiles wrap
 * into rows, so the answer depends on how many columns the width allows; the
 * tallest card wins because a mixed Board has to fit its tallest Tile.
 */
export function fitAllTileWidth(
  boardWidth: number,
  boardHeight: number,
  count: number,
  ratio: number,
): number {
  const availableWidth = boardWidth - BOARD_PAD * 2;
  const availableHeight = boardHeight - BOARD_PAD * 2;
  if (count <= 0 || !(availableWidth > 0) || !(availableHeight > 0) || !(ratio > 0)) return 0;

  let best = 0;
  for (let columns = 1; columns <= count; columns += 1) {
    const width = (availableWidth - BOARD_GAP * (columns - 1)) / columns;
    if (width < MIN_TILE_WIDTH) break;
    const rows = Math.ceil(count / columns);
    const height = tileCardHeight(width, ratio) + TILE_CHROME;
    const total = rows * height + BOARD_GAP * (rows - 1);
    if (total <= availableHeight && width > best) best = width;
  }
  if (best > 0) return best;

  // Even one column overflows: cap the card by the height instead, so the
  // Board scrolls rather than showing a Tile taller than the viewport.
  const byHeight = (availableHeight - TILE_CHROME) * ratio;
  return Math.max(MIN_TILE_WIDTH, Math.min(availableWidth, byHeight));
}

/** The Tile width a Board of `fit` shows at `zoom`. */
export function boardTileWidth(fit: number, zoom: number): number {
  if (!(fit > 0)) return 0;
  return Math.max(MIN_TILE_WIDTH, fit * clampBoardZoom(zoom));
}
