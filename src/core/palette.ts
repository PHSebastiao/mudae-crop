import { parseHexColor, toHexColor, type Rgb } from './color';
import type { DocumentState } from './document';
import { renderFrame, type RenderContext } from './render';

export const MIN_PALETTE = 4;
export const MAX_PALETTE = 10;
/** The reduced resolution the Palette is sampled at, on the longer axis. */
export const MAX_SAMPLE_SIDE = 96;

export interface PaletteColor {
  readonly hex: string;
  readonly count: number;
  /** Share of the non-transparent sampled pixels, from 0 to 1. */
  readonly share: number;
}

export interface PaletteCanvas {
  getContext(type: '2d'): RenderContext;
}

export interface PaletteAdapter {
  createCanvas(width: number, height: number): PaletteCanvas;
}

interface SampleColor extends Rgb {
  readonly count: number;
  /** First-seen order, used as a stable tie-break. */
  readonly order: number;
}

/** Weighted RGB distance, close enough to perceptual for swatch merging. */
function distance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

function sortByCoverage(colors: readonly SampleColor[]): SampleColor[] {
  return [...colors].sort((a, b) => b.count - a.count || a.order - b.order);
}

/**
 * Merge colors within `threshold` into the most-covered representative. Near
 * duplicates never produce a second swatch; their coverage adds to the first.
 */
function mergeColors(colors: readonly SampleColor[], threshold: number): SampleColor[] {
  const merged: SampleColor[] = [];
  for (const color of colors) {
    const index = merged.findIndex((rep) => distance(rep, color) <= threshold);
    if (index === -1) {
      merged.push({ ...color });
    } else {
      const rep = merged[index];
      merged[index] = { ...rep, count: rep.count + color.count };
    }
  }
  return sortByCoverage(merged);
}

/**
 * Palette from already-composited RGBA pixels. Fully transparent pixels are
 * ignored; semi-transparent ones are flattened over the Pad color first, which
 * is what the Export does. Coverage ranks the swatches.
 */
export function paletteFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  padColor: string,
): PaletteColor[] {
  const pixels = Math.min(Math.floor(data.length / 4), width * height);
  if (pixels <= 0) return [];
  const pad = parseHexColor(padColor) ?? { r: 255, g: 255, b: 255 };

  const counts = new Map<number, SampleColor>();
  let order = 0;
  let sampled = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const index = pixel * 4;
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    const a = alpha / 255;
    const r = Math.round(data[index] * a + pad.r * (1 - a));
    const g = Math.round(data[index + 1] * a + pad.g * (1 - a));
    const b = Math.round(data[index + 2] * a + pad.b * (1 - a));
    const key = (r << 16) | (g << 8) | b;
    const existing = counts.get(key);
    if (existing) {
      counts.set(key, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(key, { r, g, b, count: 1, order });
      order += 1;
    }
    sampled += 1;
  }
  if (sampled === 0) return [];

  const colors = sortByCoverage([...counts.values()]);
  let threshold = 30;
  let merged = mergeColors(colors, threshold);
  // Fewer than four swatches means the threshold was too aggressive. Relax it
  // rather than repeating a swatch; a solid image may honestly return fewer.
  while (merged.length < MIN_PALETTE && threshold > 1) {
    threshold = Math.max(1, Math.floor(threshold / 2));
    merged = mergeColors(colors, threshold);
  }

  return merged.slice(0, MAX_PALETTE).map((color) => ({
    hex: toHexColor(color),
    count: color.count,
    share: color.count / sampled,
  }));
}

/**
 * Sample the rendered Crop at a reduced resolution, without the Border. The
 * Crop, Pad and Sharpness are all part of what the user sees, so the sample
 * follows them; the Border is chrome and must never enter the Palette.
 */
export function extractPalette(
  doc: DocumentState,
  adapter: PaletteAdapter,
): PaletteColor[] {
  if (!doc.source) return [];
  const frameScale = Math.min(
    1,
    MAX_SAMPLE_SIDE / Math.max(doc.frame.width, doc.frame.height),
  );
  const width = Math.max(1, Math.round(doc.frame.width * frameScale));
  const height = Math.max(1, Math.round(doc.frame.height * frameScale));
  const canvas = adapter.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  renderFrame(ctx, doc, { scale: frameScale, border: false });
  const image = ctx.getImageData(0, 0, width, height);
  return paletteFromPixels(image.data, image.width, image.height, doc.padColor);
}
