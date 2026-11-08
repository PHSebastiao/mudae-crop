import { parseHexColor, toHexColor, type Rgb } from './color';
import { sampleTrimIndices } from './animation';
import { effectiveSource, effectiveTrim, type DocumentState } from './document';
import { renderFrame, type RenderContext } from './render';

export const MIN_PALETTE = 4;
export const MAX_PALETTE = 10;
/** The reduced resolution the Palette is sampled at, on the longer axis. */
export const MAX_SAMPLE_SIDE = 128;
/** Animations are sampled at most this many evenly spaced frames. */
export const MAX_SAMPLE_FRAMES = 60;

/** The fixed white swatch the Border starts from, always first in the UI. */
export const WHITE_SWATCH: PaletteColor = Object.freeze({
  hex: '#FFFFFF',
  count: 0,
  share: 0,
});

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

interface Hsl {
  /** Hue in degrees, 0–360. */
  readonly h: number;
  /** Saturation, 0–1. */
  readonly s: number;
  /** Lightness, 0–1. */
  readonly l: number;
}

function toHsl(color: Rgb): Hsl {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
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

const DOMINANT_SLOTS = 6;
const VIBRANT_SLOTS = 3;
const ACCENT_MIN_SATURATION = 0.28;
const ACCENT_MIN_LIGHTNESS = 0.1;
const ACCENT_MAX_LIGHTNESS = 0.92;
const HUE_BINS = 12;
const HUE_BIN_SIZE = 360 / HUE_BINS;
const DUPLICATE_DISTANCE = 32;

function hueBin(color: Rgb): number {
  return Math.floor(toHsl(color).h / HUE_BIN_SIZE) % HUE_BINS;
}

/**
 * A vibrant-accent score: saturated colors get a boost, but coverage still
 * matters so a tiny antialiased pixel cannot beat a real red shirt.
 */
function vibrantScore(color: SampleColor): number {
  const { s, l } = toHsl(color);
  if (s < ACCENT_MIN_SATURATION || l < ACCENT_MIN_LIGHTNESS || l > ACCENT_MAX_LIGHTNESS) {
    return 0;
  }
  return s * Math.pow(color.count, 0.35);
}

/**
 * A mix of Image colors (largest areas first) and Vibrant accents (new hues
 * with high saturation). This is what keeps a small red or pink shirt in the
 * list even when the neutral background owns most of the pixels.
 */
function selectSwatches(clusters: readonly SampleColor[]): SampleColor[] {
  const byCoverage = sortByCoverage(clusters);
  const selected: SampleColor[] = byCoverage.slice(0, DOMINANT_SLOTS);
  const usedHues = new Set<number>();
  for (const color of selected) {
    if (toHsl(color).s >= 0.45) usedHues.add(hueBin(color));
  }

  const accents = clusters
    .map((color) => ({ color, score: vibrantScore(color) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || b.color.count - a.color.count || a.color.order - b.color.order,
    );

  let accentsAdded = 0;
  for (const { color } of accents) {
    if (accentsAdded >= VIBRANT_SLOTS || selected.length >= MAX_PALETTE) break;
    const bin = hueBin(color);
    if (usedHues.has(bin)) continue;
    if (selected.some((picked) => distance(picked, color) <= DUPLICATE_DISTANCE)) continue;
    selected.push(color);
    usedHues.add(bin);
    accentsAdded += 1;
  }

  // Fill the rest with the next image colors by coverage. The accents stay
  // before these, so the UI's white-first cut cannot drop them.
  for (const color of byCoverage) {
    if (selected.length >= MAX_PALETTE) break;
    if (selected.some((picked) => distance(picked, color) <= DUPLICATE_DISTANCE)) continue;
    selected.push(color);
  }
  return selected;
}

/** Always show white first; it is the default Border and an easy reset. */
export function withWhiteFirst(palette: readonly PaletteColor[]): PaletteColor[] {
  const rest = palette
    .filter((color) => {
      const rgb = parseHexColor(color.hex);
      return !rgb || rgb.r < 245 || rgb.g < 245 || rgb.b < 245;
    })
    .slice(0, MAX_PALETTE - 1);
  return [WHITE_SWATCH, ...rest];
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

interface ColorCounts {
  readonly counts: Map<number, SampleColor>;
  order: number;
  sampled: number;
}

function countPixels(
  accumulator: ColorCounts,
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pad: Rgb,
): void {
  const pixels = Math.min(Math.floor(data.length / 4), width * height);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const index = pixel * 4;
    const alpha = data[index + 3];
    if (alpha === 0) continue;
    const a = alpha / 255;
    const r = Math.round(data[index] * a + pad.r * (1 - a));
    const g = Math.round(data[index + 1] * a + pad.g * (1 - a));
    const b = Math.round(data[index + 2] * a + pad.b * (1 - a));
    const key = (r << 16) | (g << 8) | b;
    const existing = accumulator.counts.get(key);
    if (existing) {
      accumulator.counts.set(key, { ...existing, count: existing.count + 1 });
    } else {
      accumulator.counts.set(key, { r, g, b, count: 1, order: accumulator.order });
      accumulator.order += 1;
    }
    accumulator.sampled += 1;
  }
}

function paletteFromCounts(accumulator: ColorCounts): PaletteColor[] {
  if (accumulator.sampled === 0) return [];
  const colors = sortByCoverage([...accumulator.counts.values()]);
  let threshold = 30;
  let merged = mergeColors(colors, threshold);
  // Fewer than four swatches means the threshold was too aggressive. Relax it
  // rather than repeating a swatch; a solid image may honestly return fewer.
  while (merged.length < MIN_PALETTE && threshold > 1) {
    threshold = Math.max(1, Math.floor(threshold / 2));
    merged = mergeColors(colors, threshold);
  }

  return selectSwatches(merged).map((color) => ({
    hex: toHexColor(color),
    count: color.count,
    share: color.count / accumulator.sampled,
  }));
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
  const pad = parseHexColor(padColor) ?? { r: 255, g: 255, b: 255 };
  const accumulator: ColorCounts = { counts: new Map(), order: 0, sampled: 0 };
  countPixels(accumulator, data, width, height, pad);
  return paletteFromCounts(accumulator);
}

/**
 * Sample the rendered Crop at a reduced resolution, without the Border. The
 * Crop, Pad and Sharpness are all part of what the user sees, so the sample
 * follows them; the Border is chrome and must never enter the Palette. An
 * animation is sampled across its active Trim, at most 60 evenly spaced frames.
 */
export function extractPalette(doc: DocumentState, adapter: PaletteAdapter): PaletteColor[] {
  if (!doc.source) return [];
  const frameScale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(doc.frame.width, doc.frame.height));
  const width = Math.max(1, Math.round(doc.frame.width * frameScale));
  const height = Math.max(1, Math.round(doc.frame.height * frameScale));
  const pad = parseHexColor(doc.padColor) ?? { r: 255, g: 255, b: 255 };
  const accumulator: ColorCounts = { counts: new Map(), order: 0, sampled: 0 };
  const canvas = adapter.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // Video frames arrive asynchronously through the player's canvas; the
  // synchronous Palette samples the frame currently on screen instead of
  // seeking the whole video.
  const indices = doc.source.video
    ? [effectiveTrim(doc)?.start ?? 0]
    : sampleTrimIndices(effectiveSource(doc), effectiveTrim(doc), MAX_SAMPLE_FRAMES);
  for (const frameIndex of indices) {
    renderFrame(ctx, doc, { scale: frameScale, border: false, frameIndex });
    const image = ctx.getImageData(0, 0, width, height);
    countPixels(accumulator, image.data, image.width, image.height, pad);
  }
  return paletteFromCounts(accumulator);
}
