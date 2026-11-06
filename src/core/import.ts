import type { ImageFormat, Source } from './document';

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
};

export function mimeFor(format: ImageFormat): string {
  return MIME[format];
}

/** Sniff the format from magic bytes, so a wrong extension cannot mislead us. */
export function detectFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }
  return null;
}

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif']);

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

function unsupportedMessage(name: string): string {
  const ext = extensionOf(name);
  return ext
    ? `Formato não suportado: .${ext}. Use PNG, JPG ou GIF.`
    : 'Formato não suportado. Use PNG, JPG ou GIF.';
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
 * A GIF decodes to its first frame because the platform decoder only hands
 * back a single bitmap.
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

  return {
    name,
    path,
    width: decoded.width,
    height: decoded.height,
    format,
    image: decoded.image,
  };
}

export function importErrorMessage(error: unknown): string {
  if (error instanceof ImportError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Não foi possível abrir essa imagem.';
}
