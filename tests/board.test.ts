import { describe, expect, it } from 'vitest';
import {
  BOARD_PAD,
  MAX_BOARD_ZOOM,
  MIN_BOARD_ZOOM,
  MIN_TILE_WIDTH,
  TILE_CHROME,
  boardTileWidth,
  boardZoomAfterWheel,
  clampBoardZoom,
  fitAllTileWidth,
  tileCardHeight,
} from '../src/core/board';

const RATIO = 9 / 14;

describe('fitAllTileWidth', () => {
  it('fits one card inside the viewport, height first', () => {
    const width = fitAllTileWidth(1000, 700, 1, RATIO);
    expect(width).toBeGreaterThan(0);
    expect(tileCardHeight(width, RATIO) + TILE_CHROME).toBeLessThanOrEqual(700 - BOARD_PAD * 2);
    expect(width).toBeLessThanOrEqual(1000 - BOARD_PAD * 2);
  });

  it('shrinks as the Board fills up', () => {
    const one = fitAllTileWidth(1000, 700, 1, RATIO);
    const six = fitAllTileWidth(1000, 700, 6, RATIO);
    const twelve = fitAllTileWidth(1000, 700, 12, RATIO);
    expect(six).toBeLessThan(one);
    expect(twelve).toBeLessThan(six);
    expect(twelve).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
  });

  it('keeps the card inside the viewport', () => {
    const width = 1000;
    const height = 700;
    const tile = fitAllTileWidth(width, height, 12, RATIO);
    expect(tile).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
    expect(tileCardHeight(tile, RATIO) + TILE_CHROME).toBeLessThanOrEqual(height - BOARD_PAD * 2);
    expect(tile).toBeLessThanOrEqual(width - BOARD_PAD * 2);
  });

  it('reports nothing for an empty Board or an unmeasured viewport', () => {
    expect(fitAllTileWidth(1000, 700, 0, RATIO)).toBe(0);
    expect(fitAllTileWidth(0, 700, 3, RATIO)).toBe(0);
    expect(fitAllTileWidth(1000, 0, 3, RATIO)).toBe(0);
  });

  it('falls back to a height-capped card when even one column overflows', () => {
    const width = fitAllTileWidth(400, 200, 40, RATIO);
    expect(width).toBeGreaterThanOrEqual(MIN_TILE_WIDTH);
    expect(tileCardHeight(width, RATIO)).toBeLessThanOrEqual(200);
  });
});

describe('Board zoom', () => {
  it('never goes below fit-all', () => {
    expect(clampBoardZoom(0.2)).toBe(MIN_BOARD_ZOOM);
    expect(clampBoardZoom(Number.NaN)).toBe(MIN_BOARD_ZOOM);
    expect(clampBoardZoom(99)).toBe(MAX_BOARD_ZOOM);
  });

  it('zooms in on scroll up and clamps at both ends', () => {
    expect(boardZoomAfterWheel(1, -120)).toBeGreaterThan(1);
    expect(boardZoomAfterWheel(1, 120)).toBe(MIN_BOARD_ZOOM);
    expect(boardZoomAfterWheel(MAX_BOARD_ZOOM, -5000)).toBe(MAX_BOARD_ZOOM);
  });

  it('scales the fit width and keeps a floor', () => {
    expect(boardTileWidth(200, 1)).toBe(200);
    expect(boardTileWidth(200, 2)).toBe(400);
    expect(boardTileWidth(20, 1)).toBe(MIN_TILE_WIDTH);
    expect(boardTileWidth(0, 2)).toBe(0);
  });
});
