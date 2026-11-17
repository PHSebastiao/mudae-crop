import { parseHexColor, toHexColor, type Rgb } from './color';
import { sampleTrimIndices } from './animation';
import { effectiveSource, effectiveTrim, type DocumentState } from './document';
import { nativeSize } from './geometry';
import { applySharpness, renderFrame, type RenderContext } from './render';
import { text } from './i18n/text';
import { KeyedError } from './errors';

export const MIN_PALETTE = 4;
export const MAX_PALETTE = 10;
/** The reduced resolution the Palette is sampled at, on the longer axis. */
export const MAX_SAMPLE_SIDE = 128;
/** Animations are sampled at most this many evenly spaced frames. */
export const MAX_SAMPLE_FRAMES = 60;
/**
 * Work allowed between yields in `extractPaletteAsync`. Counted in time, not in
 * frames: a slow machine must not turn four frames into a long task.
 */
export const PALETTE_SLICE_BUDGET_MS = 8;

export interface PaletteSamplingOptions {
  readonly signal?: AbortSignal;
  /** Gives the thread back between slices; defaults to a zero timeout. */
  readonly yieldToUi?: () => Promise<void>;
  /** Clock for the slice budget; overridable so a test can be deterministic. */
  readonly now?: () => number;
}

/** The fixed white swatch the Border starts from, always first in the UI. */
export const WHITE_SWATCH: PaletteColor = Object.freeze({
  hex: '#FFFFFF',
  count: 0,
  share: 0,
});

export interface PaletteColor {
  readonly hex: string;
  readonly count: number;
  /**
   * Share of the colours the Palette merged, from 0 to 1. Identical to a share
   * of every sampled pixel until a photographic sample exceeds the merge cap;
   * past it, the dropped tail is in no swatch and is left out of the total too.
   */
  readonly share: number;
}

export interface PaletteCanvas {
  getContext(type: '2d'): RenderContext;
}

export interface PaletteAdapter {
  createCanvas(width: number, height: number): PaletteCanvas;
  /**
   * Encode a sampled frame so the waifu2x Palette can send it through the
   * sidecar. Only the waifu2x path needs it.
   */
  encodePng?(canvas: PaletteCanvas): Promise<Uint8Array>;
}

/** Turn the sidecar's PNG back into something the palette canvas can draw. */
export type PaletteWaifu2x = (png: Uint8Array) => Promise<CanvasImageSource>;

/**
 * waifu2x runs a sidecar per frame, so its Palette samples at most this many
 * evenly spaced frames instead of the usual 60.
 */
export const MAX_WAIFU2X_PALETTE_FRAMES = 6;

interface SampleColor extends Rgb {
  /** Mutable on purpose: the accumulator counts pixels in place. */
  count: number;
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
 * Representatives the merge compares a colour against. The list is coverage
 * ordered, so the top of it holds every colour that can win a swatch; a photo's
 * long tail of near-duplicates is what makes an unbounded comparison quadratic
 * (16k distinct colours measured 118 ms).
 */
export const MAX_MERGE_COMPARISONS = 64;

/**
 * Merge colors within `threshold` into the most-covered representative. Near
 * duplicates never produce a second swatch; their coverage adds to the first.
 */
function mergeColors(colors: readonly SampleColor[], threshold: number): SampleColor[] {
  const merged: SampleColor[] = [];
  for (const color of colors) {
    const index = nearestRepresentative(merged, color, threshold);
    if (index === -1) {
      merged.push({ ...color });
    } else {
      const rep = merged[index];
      merged[index] = { ...rep, count: rep.count + color.count };
    }
  }
  return sortByCoverage(merged);
}

function nearestRepresentative(
  merged: readonly SampleColor[],
  color: SampleColor,
  threshold: number,
): number {
  const bound = Math.min(merged.length, MAX_MERGE_COMPARISONS);
  for (let index = 0; index < bound; index += 1) {
    if (distance(merged[index], color) <= threshold) return index;
  }
  return -1;
}

interface ColorCounts {
  readonly counts: Map<number, SampleColor>;
  order: number;
  sampled: number;
}

/**
 * Colours the merge actually considers. A photographic animation accumulates
 * hundreds of thousands of near-identical colours, and the merge that follows
 * then blocks the Preview (measured: 60 photographic frames, 597 ms). Only the
 * colours with real coverage can win a swatch, so the tail is selected away
 * first — the palette stays exact, the work stays bounded.
 */
export const MAX_MERGE_COLORS = 16_384;

/** The `limit` most-covered colours, selected without sorting the whole map. */
function mostCovered(colors: Iterable<SampleColor>, limit: number): SampleColor[] {
  const heap: SampleColor[] = [];
  for (const color of colors) {
    if (heap.length < limit) {
      heap.push(color);
      siftUp(heap, heap.length - 1);
    } else if (worseThan(heap[0], color)) {
      heap[0] = color;
      siftDown(heap, 0);
    }
  }
  return sortByCoverage(heap);
}

/** True when `a` ranks below `b`: less coverage, and later first-seen on a tie. */
function worseThan(a: SampleColor, b: SampleColor): boolean {
  return a.count < b.count || (a.count === b.count && a.order > b.order);
}

function siftUp(heap: SampleColor[], index: number): void {
  let child = index;
  while (child > 0) {
    const parent = (child - 1) >> 1;
    if (!worseThan(heap[child], heap[parent])) return;
    [heap[parent], heap[child]] = [heap[child], heap[parent]];
    child = parent;
  }
}

function siftDown(heap: SampleColor[], index: number): void {
  let parent = index;
  for (;;) {
    const left = parent * 2 + 1;
    const right = left + 1;
    let worst = parent;
    if (left < heap.length && worseThan(heap[left], heap[worst])) worst = left;
    if (right < heap.length && worseThan(heap[right], heap[worst])) worst = right;
    if (worst === parent) return;
    [heap[parent], heap[worst]] = [heap[worst], heap[parent]];
    parent = worst;
  }
}

/** One canvas and one accumulator, reused across the frames of a sample. */
interface PaletteSampling {
  readonly ctx: RenderContext;
  readonly width: number;
  readonly height: number;
  readonly pad: Rgb;
  readonly indices: readonly number[];
  readonly accumulator: ColorCounts;
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
      // Counting in place: a 60-frame sample used to allocate a fresh object
      // per distinct colour, per frame, which is what made it block.
      existing.count += 1;
    } else {
      accumulator.counts.set(key, { r, g, b, count: 1, order: accumulator.order });
      accumulator.order += 1;
    }
    accumulator.sampled += 1;
  }
}

function paletteFromCounts(accumulator: ColorCounts): PaletteColor[] {
  if (accumulator.sampled === 0) return [];
  const colors = mostCovered(accumulator.counts.values(), MAX_MERGE_COLORS);
  // The share is taken over the colours that reached the merge, not over every
  // sampled pixel: the tail the cap dropped is counted in no swatch, and
  // dividing by it would understate every percentage the Border tooltip shows.
  const considered = colors.reduce((total, color) => total + color.count, 0);
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
    share: considered > 0 ? color.count / considered : 0,
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
  const sampling = beginSampling(doc, adapter);
  if (!sampling) return [];
  for (const frameIndex of sampling.indices) {
    sampleFrame(sampling, doc, frameIndex);
  }
  return paletteFromCounts(sampling.accumulator);
}

/**
 * The same Palette, counted in slices: a long animation no longer freezes the
 * Preview while its frames are sampled. The caller supplies the yield so the
 * core stays free of browser APIs; an aborted signal stops between slices.
 */
export async function extractPaletteAsync(
  doc: DocumentState,
  adapter: PaletteAdapter,
  options: PaletteSamplingOptions = {},
): Promise<PaletteColor[]> {
  const sampling = beginSampling(doc, adapter);
  if (!sampling) return [];
  const yieldToUi = options.yieldToUi ?? defaultYield;
  const now = options.now ?? Date.now;
  let sliceStarted = now();
  for (const frameIndex of sampling.indices) {
    if (options.signal?.aborted) return [];
    sampleFrame(sampling, doc, frameIndex);
    if (now() - sliceStarted >= PALETTE_SLICE_BUDGET_MS) {
      await yieldToUi();
      // An abort during the yield must not return a palette nobody wants.
      if (options.signal?.aborted) return [];
      sliceStarted = now();
    }
  }
  return paletteFromCounts(sampling.accumulator);
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function beginSampling(doc: DocumentState, adapter: PaletteAdapter): PaletteSampling | null {
  if (!doc.source) return null;
  const native = nativeSize(doc);
  const frameScale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(native.width, native.height));
  const width = Math.max(1, Math.round(native.width * frameScale));
  const height = Math.max(1, Math.round(native.height * frameScale));
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
  return { ctx, width, height, pad, indices, accumulator };
}

function sampleFrame(sampling: PaletteSampling, doc: DocumentState, frameIndex: number): void {
  const { ctx, width, height, pad, accumulator } = sampling;
  renderFrame(ctx, doc, { outputWidth: width, outputHeight: height, border: false, frameIndex });
  const image = ctx.getImageData(0, 0, width, height);
  countPixels(accumulator, image.data, image.width, image.height, pad);
}

/**
 * The Palette over the waifu2x output: each sampled frame is rendered at the
 * usual reduced resolution, sent through the sidecar and drawn back before the
 * colors are counted. This is what makes a waifu2x change visible in the
 * swatches, not just a re-run of the same pixels. The sidecar cost bounds the
 * animation sample to MAX_WAIFU2X_PALETTE_FRAMES frames; a still stays at one.
 */
export async function extractPaletteWithWaifu2x(
  doc: DocumentState,
  adapter: PaletteAdapter,
  waifu2x: PaletteWaifu2x,
  signal?: AbortSignal,
): Promise<PaletteColor[]> {
  if (!doc.source) return [];
  if (!adapter.encodePng) return extractPalette(doc, adapter);

  const native = nativeSize(doc);
  const frameScale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(native.width, native.height));
  const width = Math.max(1, Math.round(native.width * frameScale));
  const height = Math.max(1, Math.round(native.height * frameScale));
  const pad = parseHexColor(doc.padColor) ?? { r: 255, g: 255, b: 255 };
  const accumulator: ColorCounts = { counts: new Map(), order: 0, sampled: 0 };
  const canvas = adapter.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // A video only has the frame currently on screen; both other kinds are
  // sampled evenly across the active Trim.
  const indices = doc.source.video
    ? [effectiveTrim(doc)?.start ?? 0]
    : sampleTrimIndices(effectiveSource(doc), effectiveTrim(doc), MAX_WAIFU2X_PALETTE_FRAMES);

  for (const frameIndex of indices) {
    if (signal?.aborted) throw new KeyedError(text('palette.cancelled'));
    // Match the Export's order: denoise the raw Crop, then sharpen it.
    renderFrame(
      ctx,
      { ...doc, sharpness: 0 },
      { outputWidth: width, outputHeight: height, border: false, frameIndex },
    );
    const png = await adapter.encodePng(canvas);
    const image = await waifu2x(png);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const rect = doc.crop.rect;
    const sharpnessScale =
      rect.width > 0 && rect.height > 0 ? Math.max(width / rect.width, height / rect.height) : 1;
    applySharpness(ctx, doc.sharpness, width, height, sharpnessScale);
    const sampled = ctx.getImageData(0, 0, width, height);
    countPixels(accumulator, sampled.data, sampled.width, sampled.height, pad);
  }

  return paletteFromCounts(accumulator);
}
