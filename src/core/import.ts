import type { AnimationFrame, ImageFormat, Source } from './document';

export type ImportErrorCode = 'unsupported' | 'corrupt' | 'empty';

export class ImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export interface DecodedImage {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  /** Present when the decoder recovered every frame of an animation. */
  readonly frames?: readonly AnimationFrame[];
  /** Raw Netscape loop field; null or absent means a single cycle. */
  readonly loopCount?: number | null;
}

export type Decoder = (bytes: Uint8Array, format: ImageFormat) => Promise<DecodedImage>;

export interface SourceCandidate {
  readonly name: string;
  readonly path: string | null;
  readonly bytes: Uint8Array;
}

const MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  apng: 'image/apng',
};

export function mimeFor(format: ImageFormat): string {
  return MIME[format];
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * A PNG with an `acTL` chunk before its image data is an APNG. The chunk walk
 * stops at the first IDAT, so a text chunk that merely mentions "acTL" cannot
 * turn a still into an animation.
 */
function isApng(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + length;
  }
  return false;
}

/** Sniff the format from magic bytes, so a wrong extension cannot mislead us. */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return isApng(bytes) ? 'apng' : 'png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'jpg';
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'gif';
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'apng']);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function unsupportedMessage(name: string): string {
  const ext = extensionOf(name);
  return ext
    ? `Formato não suportado: .${ext}. Use PNG, JPG, GIF, WebP ou APNG.`
    : 'Formato não suportado. Use PNG, JPG, GIF, WebP ou APNG.';
}

function corruptMessage(name: string): string {
  return `Não foi possível ler "${name}". O arquivo pode estar corrompido.`;
}

/**
 * The extension only chooses the wording. Content decides what is valid, so a
 * file that claims to be a PNG but is not gets the corrupt message rather than
 * a misleading "unsupported .png".
 */
function unrecognisedBytesError(name: string): ImportError {
  const ext = extensionOf(name);
  if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
    return new ImportError('corrupt', corruptMessage(name));
  }
  return new ImportError('unsupported', unsupportedMessage(name));
}

/**
 * Turn bytes into a Source. Any failure is thrown as an ImportError with a
 * specific message; callers keep the current document when that happens.
 * Animated formats decode to every composited frame; a platform decoder that
 * only hands back one bitmap still yields a valid still Source.
 */
export async function loadSource(candidate: SourceCandidate, decode: Decoder): Promise<Source> {
  const { name, path, bytes } = candidate;

  if (bytes.length === 0) {
    throw new ImportError('empty', `"${name}" está vazio.`);
  }

  // Content wins over the extension: a PNG renamed to .txt still imports.

  const format = detectFormat(bytes);
  if (!format) {
    throw unrecognisedBytesError(name);
  }

  let decoded: DecodedImage;
  try {
    decoded = await decode(bytes, format);
  } catch {
    throw new ImportError('corrupt', corruptMessage(name));
  }

  if (!decoded.width || !decoded.height) {
    throw new ImportError('corrupt', corruptMessage(name));
  }

  const animation =
    decoded.frames && decoded.frames.length > 1
      ? { frames: decoded.frames, loopCount: decoded.loopCount ?? null }
      : undefined;

  return {
    name,
    path,
    width: decoded.width,
    height: decoded.height,
    format,
    bytes: bytes.length,
    image: decoded.image,
    ...(animation ? { animation } : {}),
  };
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ImportError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível abrir essa imagem.';
}
