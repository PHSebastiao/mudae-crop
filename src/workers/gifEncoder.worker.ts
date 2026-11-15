/**
 * The expensive half of a GIF frame, off the main thread: one rendered frame per
 * message, quantized and LZW'd here so the window keeps painting while a long
 * animation encodes. The main thread still owns the GIF framing, which has to
 * stay in order.
 */
import { encodeGifFrame } from '../core/gif';

export interface GifEncodeRequest {
  readonly id: number;
  /** Transferred, so the main thread's copy for folding stays untouched. */
  readonly pixels: Uint8ClampedArray;
}

export interface GifEncodeReply {
  readonly id: number;
  /** RGB triplets, so the palette crosses without a per-colour object. */
  readonly palette: Uint8Array;
  readonly transparentIndex: number | null;
  readonly minCodeSize: number;
  readonly data: Uint8Array;
  readonly pixels: number;
  /** Set when the frame could not be encoded; the pool rejects with it. */
  readonly error?: string;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GifEncodeRequest>) => void) | null;
  postMessage: (message: GifEncodeReply, transfer?: Transferable[]) => void;
};

scope.onmessage = (event: MessageEvent<GifEncodeRequest>) => {
  const { id, pixels } = event.data;
  try {
    const frame = encodeGifFrame(pixels);
    const palette = new Uint8Array(frame.palette.length * 3);
    for (const [index, color] of frame.palette.entries()) {
      palette[index * 3] = color.r;
      palette[index * 3 + 1] = color.g;
      palette[index * 3 + 2] = color.b;
    }
    scope.postMessage(
      {
        id,
        palette,
        transparentIndex: frame.transparentIndex,
        minCodeSize: frame.minCodeSize,
        data: frame.data,
        pixels: frame.pixels,
      },
      [palette.buffer, frame.data.buffer],
    );
  } catch (reason) {
    scope.postMessage({
      id,
      palette: new Uint8Array(0),
      transparentIndex: null,
      minCodeSize: 2,
      data: new Uint8Array(0),
      pixels: 0,
      error: reason instanceof Error && reason.message ? reason.message : 'falha ao codificar',
    });
  }
};
