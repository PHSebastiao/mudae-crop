import { outputSize, type DocumentState } from './document';
import { renderFrame, type RenderContext } from './render';

export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportError';
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
