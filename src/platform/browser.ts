import type { AnimationFrame, ImageFormat } from '../core/document';
import { isVideoFormat } from '../core/document';
import type { DecodedImage, Decoder } from '../core/import';
import { mimeFor } from '../core/import';
import { decodeGif, MIN_GIF_DELAY_MS } from '../core/gif';
import type { EncodableCanvas, ExportAdapter } from '../core/export';
import { encodeCanvasPng } from '../core/png';
import type { PaletteAdapter } from '../core/palette';
import { deflateZlib } from './deflate';
import { decodeVideoWithBrowser } from './video';

/** The one place that turns image bytes into a Blob with the matching MIME. */
export function blobOf(bytes: Uint8Array, format: ImageFormat): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: mimeFor(format) });
}

/** Turn composited GIF pixels into a drawable canvas frame. */
function canvasFromPixels(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas 2D indisponível');
  const copy = new Uint8ClampedArray(pixels.length);
  copy.set(pixels);
  context.putImageData(new ImageData(copy, width, height), 0, 0);
  return canvas;
}

function decodeGifForBrowser(bytes: Uint8Array): DecodedImage {
  const decoded = decodeGif(bytes);
  const frames: AnimationFrame[] = decoded.frames.map((frame) => ({
    image: canvasFromPixels(decoded.width, decoded.height, frame.pixels),
    delayMs: frame.delayMs,
  }));
  return {
    image: frames[0].image,
    width: decoded.width,
    height: decoded.height,
    frames,
    loopCount: decoded.loopCount,
  };
}

interface WebCodecsFrame {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly duration: number | null;
  close(): void;
}

interface WebCodecsTrack {
  readonly animated: boolean;
  readonly frameCount: number;
  /** Infinity when the animation loops forever. */
  readonly repetitionCount: number;
}

interface WebCodecsTracks {
  readonly ready: Promise<void>;
  readonly selectedTrack: WebCodecsTrack | null;
}

interface WebCodecsDecoder {
  readonly tracks: WebCodecsTracks;
  decode(options: { frameIndex: number }): Promise<{ image: WebCodecsFrame }>;
  close(): void;
}

interface WebCodecsConstructor {
  new (init: { data: Uint8Array; type: string }): WebCodecsDecoder;
}

/**
 * Chromium's ImageDecoder composites animated WebP and APNG frames for us.
 * A browser without it, or an image with a single frame, falls back to the
 * ordinary still decode; a frame that fails after the track reports animation
 * propagates to the corrupt-file error instead of silently losing the frames.
 */
async function decodeWebCodecsAnimation(
  bytes: Uint8Array,
  type: 'image/webp' | 'image/apng',
): Promise<DecodedImage | null> {
  const Constructor = (globalThis as { ImageDecoder?: WebCodecsConstructor }).ImageDecoder;
  if (!Constructor) return null;

  let decoder: WebCodecsDecoder;
  try {
    decoder = new Constructor({ data: bytes, type });
    await decoder.tracks.ready;
  } catch {
    return null;
  }

  try {
    const track = decoder.tracks.selectedTrack;
    if (!track || !track.animated || track.frameCount <= 1) return null;

    const frames: AnimationFrame[] = [];
    let frameWidth = 0;
    let frameHeight = 0;
    for (let index = 0; index < track.frameCount; index += 1) {
      const { image } = await decoder.decode({ frameIndex: index });
      frameWidth = image.displayWidth;
      frameHeight = image.displayHeight;
      const canvas = document.createElement('canvas');
      canvas.width = frameWidth;
      canvas.height = frameHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        image.close();
        throw new Error('canvas 2D indisponível');
      }
      context.drawImage(image as unknown as CanvasImageSource, 0, 0);
      const duration = image.duration;
      image.close();
      frames.push({
        image: canvas,
        delayMs: Math.max(
          MIN_GIF_DELAY_MS,
          Math.round((duration && Number.isFinite(duration) ? duration : 100_000) / 1000),
        ),
      });
    }

    if (frames.length <= 1) return null;
    const repetitions = track.repetitionCount;
    return {
      image: frames[0].image,
      width: frameWidth,
      height: frameHeight,
      frames,
      loopCount: Number.isFinite(repetitions)
        ? repetitions > 0
          ? Math.round(repetitions)
          : null
        : 0,
    };
  } finally {
    // A decode failure propagates to the import error path; only an absent or
    // unsupported decoder falls back to the still bitmap.
    decoder.close();
  }
}

export const decodeWithBrowser: Decoder = async (
  bytes: Uint8Array,
  format: ImageFormat,
): Promise<DecodedImage> => {
  if (isVideoFormat(format)) {
    return decodeVideoWithBrowser(bytes, format);
  }
  if (format === 'gif') {
    return decodeGifForBrowser(bytes);
  }
  if (format === 'webp' || format === 'apng') {
    const animation = await decodeWebCodecsAnimation(
      bytes,
      format === 'webp' ? 'image/webp' : 'image/apng',
    );
    if (animation) return animation;
  }
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
  // Our writer instead of `canvas.toBlob`: it filters each row on its own and
  // drops an opaque alpha plane, which is about a third of a photo Export.
  encodePng: (canvas: EncodableCanvas): Promise<Uint8Array> => encodeCanvasPng(canvas, deflateZlib),
  async decodePng(bytes: Uint8Array): Promise<CanvasImageSource> {
    return createImageBitmap(blobOf(bytes, 'png'));
  },
};

export const browserPaletteAdapter: PaletteAdapter = {
  createCanvas: (width, height) => canvasFrom({ width, height }),
  encodePng: (canvas) => browserExportAdapter.encodePng(canvas as unknown as EncodableCanvas),
};
