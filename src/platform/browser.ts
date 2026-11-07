import type { ImageFormat } from '../core/document';
import type { DecodedImage, Decoder } from '../core/import';
import { mimeFor } from '../core/import';
import { ExportError, type EncodableCanvas, type ExportAdapter } from '../core/export';
import type { PaletteAdapter } from '../core/palette';

/** The one place that turns image bytes into a Blob with the matching MIME. */
export function blobOf(bytes: Uint8Array, format: ImageFormat): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mimeFor(format) });
}

export const decodeWithBrowser: Decoder = async (
  bytes: Uint8Array,
  format: ImageFormat,
): Promise<DecodedImage> => {
  // Chromium decodes the first frame of a GIF here, which is exactly the
  // still-Source rule this ticket needs.
  const bitmap = await createImageBitmap(blobOf(bytes, format));
  return { image: bitmap, width: bitmap.width, height: bitmap.height };
};

function canvasFrom(size: { width: number; height: number }): EncodableCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  return canvas as unknown as EncodableCanvas;
}

export const browserExportAdapter: ExportAdapter = {
  createCanvas: (width, height) => canvasFrom({ width, height }),
  async encodePng(canvas: EncodableCanvas): Promise<Uint8Array> {
    const element = canvas as unknown as HTMLCanvasElement;
    const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
    if (!blob) throw new ExportError('Falha ao codificar o PNG.');
    return new Uint8Array(await blob.arrayBuffer());
  },
};

export const browserPaletteAdapter: PaletteAdapter = {
  createCanvas: (width, height) => canvasFrom({ width, height }),
};
