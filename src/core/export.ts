import {
  baseOutputSize,
  effectiveDelayMs,
  effectiveSource,
  effectiveTrim,
  isAnimated,
  outputSize,
  trimFrameCount,
  type DocumentState,
  type Source,
} from './document';
import { sampleTrimIndices } from './animation';
import { GifWriter, type GifEncodeFrame } from './gif';
import {
  OptimizeCancelledError,
  optimizeGif,
  sameFramePixels,
  type GifOptimizer,
  type OptimizeResult,
} from './optimize';
import {
  applySharpness,
  paintFrameBorder,
  prepareContext,
  renderFrame,
  type BorderScale,
  type RenderContext,
} from './render';
import { Waifu2xError } from './waifu2x';

export class ExportError extends Error {
  /** True when the user cancelled a long render; the document is untouched. */
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'ExportError';
    this.cancelled = cancelled;
  }
}

export interface EncodableCanvas {
  readonly width: number;
  readonly height: number;
  getContext(type: '2d'): RenderContext;
}

export interface ExportAdapter {
  createCanvas(width: number, height: number): EncodableCanvas;
  encodePng(canvas: EncodableCanvas): Promise<Uint8Array>;
  /**
   * Turn the sidecar's PNG back into a drawable. Only the waifu2x path needs
   * it, so a caller that never enables waifu2x may omit it.
   */
  decodePng?(bytes: Uint8Array): Promise<CanvasImageSource>;
}

export interface Waifu2xFrameRequest {
  /** The rendered Crop as a PNG, before the Border. */
  readonly input: Uint8Array;
  readonly frameIndex: number;
  readonly signal?: AbortSignal;
}

/** The waifu2x seam: one rendered PNG in, one processed PNG out. */
export type Waifu2xFrameRunner = (request: Waifu2xFrameRequest) => Promise<Uint8Array>;

/**
 * Render one output raster through the normal pipeline and, when a waifu2x
 * runner is present, through the sidecar before the Border. Sharpness is
 * deferred to the final raster in that case, so denoise sees the raw Crop
 * instead of a sharpened one.
 */
async function renderOutputFrame(
  doc: DocumentState,
  adapter: ExportAdapter,
  options: {
    readonly base: { width: number; height: number };
    readonly output: { width: number; height: number };
    readonly frameIndex: number;
    readonly waifu2x?: Waifu2xFrameRunner;
    readonly signal?: AbortSignal;
  },
): Promise<EncodableCanvas> {
  const { base, output } = options;
  const baseCanvas = adapter.createCanvas(base.width, base.height);
  const baseCtx = baseCanvas.getContext('2d');
  renderFrame(baseCtx, options.waifu2x ? { ...doc, sharpness: 0 } : doc, {
    outputWidth: base.width,
    outputHeight: base.height,
    border: false,
    frameIndex: options.frameIndex,
  });

  if (!options.waifu2x) {
    if (doc.border.width > 0) {
      paintFrameBorder(baseCtx, doc, base.width, base.height);
    }
    return baseCanvas;
  }

  const input = await adapter.encodePng(baseCanvas);
  let processed: Uint8Array;
  try {
    processed = await options.waifu2x({
      input,
      frameIndex: options.frameIndex,
      signal: options.signal,
    });
  } catch (reason) {
    throw waifu2xExportError(reason);
  }
  if (!adapter.decodePng) {
    throw new ExportError('A saída do waifu2x não pôde ser lida.');
  }
  const image = await adapter.decodePng(processed);

  const canvas = adapter.createCanvas(output.width, output.height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, output.width, output.height);
  prepareContext(ctx);
  ctx.drawImage(image, 0, 0, output.width, output.height);
  const rect = doc.crop.rect;
  const scale =
    rect.width > 0 && rect.height > 0
      ? Math.max(output.width / rect.width, output.height / rect.height)
      : 1;
  applySharpness(ctx, doc.sharpness, output.width, output.height, scale);
  if (doc.border.width > 0) {
    paintFrameBorder(ctx, doc, output.width, output.height);
  }
  return canvas;
}

/** The file formats the Export path can write today. */
export type ExportFileFormat = 'png' | 'gif';

export interface ExportKind {
  readonly format: ExportFileFormat;
  readonly label: string;
  readonly contentType: string;
}

/**
 * The chosen Export format for a Source: stills are always PNG, animations can
 * be PNG (the selected frame) or GIF. `preferred` is the user's last choice.
 */
export function exportKindFor(
  source: Source | null | undefined,
  preferred: ExportFileFormat = 'gif',
): ExportKind {
  const format: ExportFileFormat = isAnimated(source) && preferred !== 'png' ? 'gif' : 'png';
  return format === 'gif'
    ? { format: 'gif', label: 'GIF', contentType: 'image/gif' }
    : { format: 'png', label: 'PNG', contentType: 'image/png' };
}

/** Seek a video-backed Source to the frame before drawing it. */
export async function prepareFrame(
  source: Source | null | undefined,
  frameIndex: number,
): Promise<void> {
  if (source?.video) await source.video.seekToFrame(frameIndex);
}

/** How many GIF frames a size estimate encodes before extrapolating. */
export const MAX_ESTIMATE_FRAMES = 8;

/** Above this many output pixels a GIF estimate is too slow to run per edit. */
export const MAX_ESTIMATE_PIXELS = 2_000_000;

export interface SizeEstimate {
  readonly bytes: number;
  /** True when the whole Export was encoded, not extrapolated or capped. */
  readonly exact: boolean;
}

export interface SizeEstimateOptions {
  readonly format: ExportFileFormat;
  readonly frameIndex?: number;
  /** Override the sampling pixel budget (tests use a tiny one). */
  readonly maxPixels?: number;
}

/** Render one Frame and pack it exactly as the GIF writer consumes it. */
function renderedGifFrame(
  ctx: RenderContext,
  doc: DocumentState,
  size: { width: number; height: number },
  frameIndex: number,
  border?: BorderScale,
): GifEncodeFrame {
  renderFrame(ctx, doc, {
    outputWidth: size.width,
    outputHeight: size.height,
    border,
    frameIndex,
  });
  const image = ctx.getImageData(0, 0, size.width, size.height);
  return {
    pixels: new Uint8ClampedArray(image.data),
    delayMs: effectiveDelayMs(effectiveSource(doc), frameIndex, doc.speed),
  };
}

export interface PngExportOptions {
  readonly frameIndex?: number;
  /** Video Sources need this seek before the synchronous render. */
  readonly prepare?: () => Promise<void>;
  readonly signal?: AbortSignal;
  /** Present only while waifu2x is on. */
  readonly waifu2x?: Waifu2xFrameRunner;
}

/**
 * Render one frame through the same entry point as Preview and encode it as
 * PNG. With waifu2x on, the Crop is rendered at the base size, processed, then
 * sharpened and bordered at the final Export size. The caller writes the bytes
 * wherever the user chose in the save dialog.
 */
export async function renderPng(
  doc: DocumentState,
  adapter: ExportAdapter,
  options: PngExportOptions = {},
): Promise<Uint8Array> {
  if (!doc.source) {
    throw new ExportError('Não há Source para exportar.');
  }
  if (doc.waifu2x.enabled && !options.waifu2x) {
    throw new ExportError('O waifu2x não está disponível.');
  }
  await options.prepare?.();
  const base = baseOutputSize(doc);
  const output = outputSize(doc);
  const canvas = await renderOutputFrame(doc, adapter, {
    base,
    output,
    frameIndex: options.frameIndex ?? 0,
    waifu2x: options.waifu2x,
    signal: options.signal,
  });
  return adapter.encodePng(canvas);
}

/**
 * Estimate the Export's file size without writing it. A still PNG is encoded
 * for real when it fits the pixel budget; above it, a reduced raster is encoded
 * and the bytes scaled by area (marked approximate). A GIF encodes up to
 * MAX_ESTIMATE_FRAMES evenly spaced frames and scales by the active Trim length;
 * every frame carries its own palette and LZW data, so the cost is close to
 * additive. Above the same budget a native-resolution tile stands in for the
 * whole frame. An enabled Optimize caps the estimate at its target (the panel
 * shows it as "≤"), because the optimizer can miss the goal; the estimate is
 * never called exact then. A video Source
 * samples the frame currently on screen, since seeking every sample would
 * flicker Preview.
 */
export async function estimateExportSize(
  doc: DocumentState,
  adapter: ExportAdapter,
  options: SizeEstimateOptions,
): Promise<SizeEstimate> {
  const source = doc.source;
  if (!source) throw new ExportError('Não há Source para exportar.');

  // waifu2x cannot run inside a size estimate (it would spawn the sidecar on
  // every debounced edit). Estimate the final raster without it and mark the
  // result approximate; the processed file compresses differently.
  const waifu = doc.waifu2x.enabled;
  const measureDoc = waifu
    ? { ...doc, waifu2x: { ...doc.waifu2x, enabled: false }, resize: outputSize(doc) }
    : doc;

  if (options.format === 'png') {
    const size = outputSize(measureDoc);
    const pixelCount = size.width * size.height;
    const budget = Math.max(1, options.maxPixels ?? MAX_ESTIMATE_PIXELS);
    if (pixelCount > budget) {
      // Encoding 10+ megapixels on every debounced edit is too slow. Encode a
      // reduced raster and scale by area; the panel marks it approximate.
      const ratio = Math.sqrt(budget / pixelCount);
      const sample = {
        width: Math.max(1, Math.round(size.width * ratio)),
        height: Math.max(1, Math.round(size.height * ratio)),
      };
      const canvas = adapter.createCanvas(sample.width, sample.height);
      renderFrame(canvas.getContext('2d'), measureDoc, {
        outputWidth: sample.width,
        outputHeight: sample.height,
        border: { scale: sample.width / size.width, minPx: 0 },
        frameIndex: options.frameIndex ?? 0,
      });
      const bytes = await adapter.encodePng(canvas);
      return {
        bytes: Math.round((bytes.length * pixelCount) / (sample.width * sample.height)),
        exact: false,
      };
    }
    const bytes = await renderPng(measureDoc, adapter, { frameIndex: options.frameIndex ?? 0 });
    return { bytes: bytes.length, exact: !waifu };
  }

  const view = effectiveSource(doc);
  if (!view) throw new ExportError('Não há Source para exportar.');
  const trim = effectiveTrim(doc);
  if (!trim) throw new ExportError('A Source não é animada.');

  const size = outputSize(measureDoc);
  // Above the pixel budget, estimate from a native-resolution tile in the
  // middle of the Crop and scale by area. A downscaled render would change the
  // per-pixel compression cost; a tile keeps the Source's own detail.
  const pixelCount = size.width * size.height;
  const budget = Math.max(1, options.maxPixels ?? MAX_ESTIMATE_PIXELS);
  const sampling = pixelCount > budget;
  let estimateDoc = measureDoc;
  let sampleSize = size;
  if (sampling) {
    // The tile is cut from the native Crop, so the budget must be measured
    // against the larger of the output and the Crop: an export smaller than its
    // Crop would otherwise sample more native pixels than the budget allows.
    const ratio =
      size.width > 0 && size.height > 0
        ? Math.sqrt(
            budget / Math.max(pixelCount, measureDoc.crop.rect.width * measureDoc.crop.rect.height),
          )
        : 1;
    const rect = measureDoc.crop.rect;
    // A floor keeps a tiny Crop from collapsing to a one-pixel tile; a Crop
    // smaller than the floor is only coarsely estimated.
    const tileWidth = Math.min(rect.width, Math.max(64, rect.width * ratio));
    const tileHeight = Math.min(rect.height, Math.max(64, rect.height * ratio));
    estimateDoc = {
      ...measureDoc,
      crop: {
        ...measureDoc.crop,
        rect: {
          x: rect.x + (rect.width - tileWidth) / 2,
          y: rect.y + (rect.height - tileHeight) / 2,
          width: tileWidth,
          height: tileHeight,
        },
      },
    };
    sampleSize = {
      width: Math.max(1, Math.round(tileWidth)),
      height: Math.max(1, Math.round(tileHeight)),
    };
  }
  const samplePixels = sampleSize.width * sampleSize.height;

  const total = trimFrameCount(view, trim);
  const indices = sampleTrimIndices(view, trim, MAX_ESTIMATE_FRAMES);
  const canvas = adapter.createCanvas(sampleSize.width, sampleSize.height);
  const ctx = canvas.getContext('2d');
  const writer = new GifWriter({
    width: sampleSize.width,
    height: sampleSize.height,
    loopCount: view.video ? 0 : (view.animation?.loopCount ?? null),
  });
  for (const [slot, frameIndex] of indices.entries()) {
    // The tile carries the Border at the real export's proportion, not at the
    // tile's own scale, so the area scaling does not inflate it.
    const border = sampling ? { scale: sampleSize.width / size.width, minPx: 0 } : undefined;
    writer.addFrame(renderedGifFrame(ctx, estimateDoc, sampleSize, frameIndex, border));
    // Keep the window responsive while a large GIF is measured.
    if (slot + 1 < indices.length) await yieldToUi();
  }

  const sampled = writer.finish();
  const whole = indices.length >= total;
  const sampledBytes = whole
    ? sampled.length
    : Math.round((sampled.length * total) / indices.length);
  const rawBytes = sampling ? Math.round(sampledBytes * (pixelCount / samplePixels)) : sampledBytes;

  if (doc.optimize.enabled) {
    const target = doc.optimize.targetEnabled ? doc.optimize.targetBytes : null;
    return { bytes: target === null ? rawBytes : Math.min(rawBytes, target), exact: false };
  }
  return { bytes: rawBytes, exact: whole && !sampling && !waifu };
}

export interface RenderProgress {
  readonly phase: 'render' | 'waifu2x' | 'optimize';
  readonly done: number;
  readonly total: number;
}

export interface GifExportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RenderProgress) => void;
  readonly optimizer?: GifOptimizer;
  readonly onOptimized?: (result: OptimizeResult) => void;
  /** Present only while waifu2x is on. */
  readonly waifu2x?: Waifu2xFrameRunner;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function cancelledError(): ExportError {
  return new ExportError('Export cancelado.', true);
}

/** A cancelled sidecar is an ordinary cancelled Export, not a crash. */
function waifu2xExportError(reason: unknown): unknown {
  if (reason instanceof Waifu2xError) {
    return reason.cancelled ? cancelledError() : new ExportError(reason.message);
  }
  return reason;
}

/**
 * Render the active Trim of an animated Source through renderFrame, encode it
 * as a GIF at the document's output size, and optionally run the lossy
 * optimizer. Video frames are seeked before each render. Progress covers
 * rendering, encoding and optimization; AbortSignal stops any of them.
 */
export async function renderGif(
  doc: DocumentState,
  adapter: ExportAdapter,
  options: GifExportOptions = {},
): Promise<Uint8Array> {
  const view = effectiveSource(doc);
  if (!view) {
    throw new ExportError('Não há Source para exportar.');
  }
  const trim = effectiveTrim(doc);
  if (!trim) {
    throw new ExportError('A Source não é animada.');
  }
  if (doc.waifu2x.enabled && !options.waifu2x) {
    throw new ExportError('O waifu2x não está disponível.');
  }

  const baseSize = baseOutputSize(doc);
  const size = outputSize(doc);
  const usingWaifu2x = doc.waifu2x.enabled;
  // The plain path keeps one canvas for every frame; waifu2x needs a new base
  // and output canvas per frame because the sidecar owns the decode.
  const canvas = adapter.createCanvas(
    usingWaifu2x ? baseSize.width : size.width,
    usingWaifu2x ? baseSize.height : size.height,
  );
  const ctx = canvas.getContext('2d');
  const total = trimFrameCount(view, trim);
  const writer = new GifWriter({
    width: size.width,
    height: size.height,
    loopCount: view.video ? 0 : (view.animation?.loopCount ?? null),
  });
  let pending: GifEncodeFrame | null = null;
  let dropped = 0;

  for (let offset = 0; offset < total; offset += 1) {
    if (options.signal?.aborted) throw cancelledError();
    const frameIndex = trim.start + offset;
    await prepareFrame(view, frameIndex);

    let frame: GifEncodeFrame;
    if (usingWaifu2x) {
      const outputCanvas = await renderOutputFrame(doc, adapter, {
        base: baseSize,
        output: size,
        frameIndex,
        waifu2x: options.waifu2x,
        signal: options.signal,
      });
      const outputCtx = outputCanvas.getContext('2d');
      frame = {
        pixels: new Uint8ClampedArray(outputCtx.getImageData(0, 0, size.width, size.height).data),
        delayMs: effectiveDelayMs(view, frameIndex, doc.speed),
      };
    } else {
      frame = renderedGifFrame(ctx, doc, size, frameIndex);
    }

    if (doc.optimize.enabled) {
      // Stream the previous frame out and keep only one in memory while
      // merging consecutive duplicates.
      if (pending && sameFramePixels(pending.pixels, frame.pixels)) {
        pending = { pixels: pending.pixels, delayMs: pending.delayMs + frame.delayMs };
        dropped += 1;
      } else {
        if (pending) writer.addFrame(pending);
        pending = frame;
      }
    } else {
      writer.addFrame(frame);
    }

    options.onProgress?.({
      phase: usingWaifu2x ? 'waifu2x' : 'render',
      done: offset + 1,
      total,
    });
    // Give the progress notice and the cancel button a chance to paint.
    if (offset + 1 < total) await yieldToUi();
  }

  if (pending) writer.addFrame(pending);
  if (options.signal?.aborted) throw cancelledError();
  const base = writer.finish();

  if (!doc.optimize.enabled || !options.optimizer) return base;

  try {
    const result = await optimizeGif(base, doc.optimize, options.optimizer, dropped, {
      signal: options.signal,
      onProgress: (done, optimizeTotal) =>
        options.onProgress?.({ phase: 'optimize', done, total: optimizeTotal }),
    });
    options.onOptimized?.(result);
    return result.bytes;
  } catch (reason) {
    if (reason instanceof OptimizeCancelledError) throw cancelledError();
    throw reason;
  }
}
