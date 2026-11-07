import {
  clampTrim,
  frameDelayMs,
  isAnimated,
  outputSize,
  trimFrameCount,
  type DocumentState,
  type Source,
} from './document';
import { GifError, encodeGif, type GifEncodeFrame } from './gif';
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

/** Stills Export as PNG and animations as GIF; nothing else asks the user. */
export function exportKindFor(source: Source | null | undefined): ExportKind {
  return isAnimated(source)
    ? { format: 'gif', label: 'GIF', contentType: 'image/gif' }
    : { format: 'png', label: 'PNG', contentType: 'image/png' };
}

/**
 * Render the document at 1× (or later 2×) through the same entry point as
 * Preview and encode it as PNG. The caller writes the bytes wherever the user
 * chose in the save dialog.
 */
export async function renderPng(
  doc: DocumentState,
  scale: number,
  adapter: ExportAdapter,
): Promise<Uint8Array> {
  if (!doc.source) {
    throw new ExportError('Não há Source para exportar.');
  }
  const size = outputSize(doc, scale);
  const canvas = adapter.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  renderFrame(ctx, doc, { scale });
  return adapter.encodePng(canvas);
}

export interface GifExportOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (done: number, total: number) => void;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function cancelledError(): ExportError {
  return new ExportError('Export cancelado.', true);
}

/**
 * Render only the active Trim of an animated Source and encode it as a GIF at
 * the Frame's output size. Each frame goes through renderFrame, so the GIF
 * always matches Preview. Progress covers rendering and encoding, and an
 * AbortSignal stops both loops without touching the document.
 */
export async function renderGif(
  doc: DocumentState,
  scale: number,
  adapter: ExportAdapter,
  options: GifExportOptions = {},
): Promise<Uint8Array> {
  const source = doc.source;
  if (!source) {
    throw new ExportError('Não há Source para exportar.');
  }
  const trim = clampTrim(source, doc.trim);
  if (!trim) {
    throw new ExportError('A Source não é animada.');
  }

  const size = outputSize(doc, scale);
  const canvas = adapter.createCanvas(size.width, size.height);
  const ctx = canvas.getContext('2d');
  const total = trimFrameCount(source, trim);
  // Rendering and quantization both take about the same pass over the frames.
  const overall = total * 2;
  const frames: GifEncodeFrame[] = [];

  for (let offset = 0; offset < total; offset += 1) {
    if (options.signal?.aborted) throw cancelledError();
    const frameIndex = trim.start + offset;
    renderFrame(ctx, doc, { scale, frameIndex });
    const image = ctx.getImageData(0, 0, size.width, size.height);
    frames.push({
      pixels: new Uint8ClampedArray(image.data),
      delayMs: frameDelayMs(source, frameIndex),
    });
    options.onProgress?.(offset + 1, overall);
    // Give the progress notice and the cancel button a chance to paint.
    if (offset + 1 < total) await yieldToUi();
  }

  if (options.signal?.aborted) throw cancelledError();
  let bytes: Uint8Array;
  try {
    bytes = await encodeGif(
      frames,
      {
        width: size.width,
        height: size.height,
        loopCount: source.animation?.loopCount ?? null,
      },
      {
        signal: options.signal,
        onProgress: (done) => options.onProgress?.(total + done, overall),
      },
    );
  } catch (reason) {
    if (reason instanceof GifError && reason.code === 'cancelled') {
      throw cancelledError();
    }
    throw reason;
  }
  return bytes;
}
