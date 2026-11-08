import {
  effectiveDelayMs,
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
import { renderFrame, type RenderContext } from './render';

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
}

/** Render one Frame and pack it exactly as the GIF writer consumes it. */
function renderedGifFrame(
  ctx: RenderContext,
  doc: DocumentState,
  size: { width: number; height: number },
  frameIndex: number,
): GifEncodeFrame {
  renderFrame(ctx, doc, {
    outputWidth: size.width,
    outputHeight: size.height,
    frameIndex,
  });
  const image = ctx.getImageData(0, 0, size.width, size.height);
  return {
    pixels: new Uint8ClampedArray(image.data),
    delayMs: effectiveDelayMs(doc.source, frameIndex, doc.speed),
  };
}

export interface PngExportOptions {
  readonly frameIndex?: number;
  /** Video Sources need this seek before the synchronous render. */
  readonly prepare?: () => Promise<void>;
}

/**
 * Render one frame through the same entry point as Preview and encode it as
 * PNG. The caller writes the bytes wherever the user chose in the save dialog.
 */
export async function renderPng(
  doc: DocumentState,
  adapter: ExportAdapter,
  options: PngExportOptions = {},
): Promise<Uint8Array> {
  if (!doc.source) {
    throw new ExportError('Não há Source para exportar.');
  }
  await options.prepare?.();
  const size = outputSize(doc);
  const canvas = adapter.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  renderFrame(ctx, doc, {
    outputWidth: size.width,
    outputHeight: size.height,
    frameIndex: options.frameIndex ?? 0,
  });
  return adapter.encodePng(canvas);
}

/**
 * Estimate the Export's file size without writing it. A still PNG is encoded
 * for real. A GIF encodes up to MAX_ESTIMATE_FRAMES evenly spaced frames and
 * scales by the active Trim length; every frame carries its own palette and
 * LZW data, so the cost is close to additive. An enabled Optimize caps the
 * estimate at its target (the panel shows it as "≤"), because the optimizer
 * can miss the goal; the estimate is never called exact then. A video Source
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

  if (options.format === 'png') {
    const bytes = await renderPng(doc, adapter, { frameIndex: options.frameIndex ?? 0 });
    return { bytes: bytes.length, exact: true };
  }

  const trim = effectiveTrim(doc);
  if (!trim) throw new ExportError('A Source não é animada.');

  const size = outputSize(doc);
  if (size.width * size.height > MAX_ESTIMATE_PIXELS) {
    throw new ExportError('Export grande demais para estimar; o tamanho aparece ao exportar.');
  }

  const total = trimFrameCount(source, trim);
  const indices = sampleTrimIndices(source, trim, MAX_ESTIMATE_FRAMES);
  const canvas = adapter.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const writer = new GifWriter({
    width: size.width,
    height: size.height,
    loopCount: source.video ? 0 : (source.animation?.loopCount ?? null),
  });
  for (const [slot, frameIndex] of indices.entries()) {
    writer.addFrame(renderedGifFrame(ctx, doc, size, frameIndex));
    // Keep the window responsive while a large GIF is measured.
    if (slot + 1 < indices.length) await yieldToUi();
  }

  const sampled = writer.finish();
  const whole = indices.length >= total;
  const rawBytes = whole ? sampled.length : Math.round((sampled.length * total) / indices.length);

  if (doc.optimize.enabled) {
    const target = doc.optimize.targetEnabled ? doc.optimize.targetBytes : null;
    return { bytes: target === null ? rawBytes : Math.min(rawBytes, target), exact: false };
  }
  return { bytes: rawBytes, exact: whole };
}

export interface RenderProgress {
  readonly phase: 'render' | 'optimize';
  readonly done: number;
  readonly total: number;
}

export interface GifExportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: RenderProgress) => void;
  readonly optimizer?: GifOptimizer;
  readonly onOptimized?: (result: OptimizeResult) => void;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function cancelledError(): ExportError {
  return new ExportError('Export cancelado.', true);
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
  const source = doc.source;
  if (!source) {
    throw new ExportError('Não há Source para exportar.');
  }
  const trim = effectiveTrim(doc);
  if (!trim) {
    throw new ExportError('A Source não é animada.');
  }

  const size = outputSize(doc);
  const canvas = adapter.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const total = trimFrameCount(source, trim);
  const writer = new GifWriter({
    width: size.width,
    height: size.height,
    loopCount: source.video ? 0 : (source.animation?.loopCount ?? null),
  });
  let pending: GifEncodeFrame | null = null;
  let dropped = 0;

  for (let offset = 0; offset < total; offset += 1) {
    if (options.signal?.aborted) throw cancelledError();
    const frameIndex = trim.start + offset;
    await prepareFrame(source, frameIndex);
    const frame = renderedGifFrame(ctx, doc, size, frameIndex);

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

    options.onProgress?.({ phase: 'render', done: offset + 1, total });
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
