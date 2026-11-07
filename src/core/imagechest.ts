/**
 * The Image Chest API v1 surface the upload path needs. Everything here is
 * pure: the native transport turns an ImageChestRequest into an HTTP call, so
 * the request shape, the error wording and the link extraction stay testable
 * without a network.
 *
 * Docs: https://imgchest.com/docs/api/1.0/endpoints/post
 */
import { MAX_DOWNLOAD_BYTES } from './download';
import { asRecord, parseJson } from './json';

export type Privacy = 'public' | 'hidden' | 'secret';

export const PRIVACY_OPTIONS: ReadonlyArray<{ value: Privacy; label: string }> = [
  { value: 'hidden', label: 'Oculta (hidden)' },
  { value: 'public', label: 'Pública (public)' },
  { value: 'secret', label: 'Secreta (secret)' },
];

/** Where Image Chest hands out the personal API token. */
export const IMAGE_CHEST_API_KEY_URL = 'https://imgchest.com/profile/api';

/** The Image Chest per-file ceiling; the same as the download ceiling. */
export const MAX_UPLOAD_BYTES = MAX_DOWNLOAD_BYTES;

export interface UploadFile {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface ImageChestRequest {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly token: string;
  /** Scalar multipart fields; only used by POSTs. */
  readonly form?: Readonly<Record<string, string>>;
  /** The single file part; only used by POSTs. */
  readonly file?: {
    readonly field: string;
    readonly name: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  };
}

export interface ImageChestResponse {
  readonly status: number;
  readonly body: string;
  readonly retryAfterSeconds: number | null;
}

/** The seam between the client and the native HTTP request. */
export interface ImageChestTransport {
  send(request: ImageChestRequest): Promise<ImageChestResponse>;
}

export type ImageChestErrorCode =
  | 'no-token'
  | 'unauthorized'
  | 'too-large'
  | 'rate-limited'
  | 'offline'
  | 'invalid-post'
  | 'server'
  | 'malformed';

export class ImageChestError extends Error {
  readonly code: ImageChestErrorCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ImageChestErrorCode,
    message: string,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ImageChestError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface Account {
  readonly name: string;
}

export interface UploadOutcome {
  readonly link: string;
  readonly postId: string;
  readonly imageId: string;
}

export interface UploadInput {
  readonly transport: ImageChestTransport;
  readonly token: string;
  readonly file: UploadFile;
  readonly title: string;
  readonly privacy: Privacy;
  /** When set, the Export is appended to this Post after validating it. */
  readonly postId?: string | null;
}

export function isPostId(value: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(value);
}

export function isImageChestLink(link: string): boolean {
  try {
    const url = new URL(link);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'imgchest.com' || url.hostname.endsWith('.imgchest.com'))
    );
  } catch {
    return false;
  }
}

export function uploadErrorMessage(error: unknown): string {
  if (error instanceof ImageChestError) return error.message;
  if (error instanceof Error && error.message) {
    return `Não foi possível subir o Export. ${error.message}`;
  }
  return 'Não foi possível subir o Export. Tente de novo.';
}

function unauthorized(): ImageChestError {
  return new ImageChestError(
    'unauthorized',
    'O token do Image Chest foi recusado. Confira o token em Configurações.',
    401,
  );
}

function noToken(): ImageChestError {
  return new ImageChestError(
    'no-token',
    'Salve o token do Image Chest em Configurações antes de subir.',
  );
}

function tooLarge(): ImageChestError {
  return new ImageChestError(
    'too-large',
    'O Export passa de 30 MB, o limite do Image Chest. Reduza a escala ou otimize o arquivo.',
    413,
  );
}

function rateLimited(seconds: number): ImageChestError {
  return new ImageChestError(
    'rate-limited',
    `O Image Chest está limitando os pedidos. Tente de novo em ${seconds}s.`,
    429,
    seconds,
  );
}

function serverFailure(status: number): ImageChestError {
  return new ImageChestError(
    'server',
    `O Image Chest respondeu ${status}. Tente de novo em instantes.`,
    status,
  );
}

function malformed(): ImageChestError {
  return new ImageChestError(
    'malformed',
    'O Image Chest respondeu sem um link direto. Tente de novo.',
  );
}

function malformedAccount(): ImageChestError {
  return new ImageChestError(
    'malformed',
    'O Image Chest respondeu sem os dados da conta. Confira o token.',
  );
}

function invalidPost(postId: string, reason: string): ImageChestError {
  return new ImageChestError(
    'invalid-post',
    `O Post "${postId}" ${reason}. Confira o id.`,
    404,
  );
}

async function send(
  transport: ImageChestTransport,
  request: ImageChestRequest,
): Promise<ImageChestResponse> {
  try {
    return await transport.send(request);
  } catch (reason) {
    if (reason instanceof ImageChestError) throw reason;
    const detail = reason instanceof Error && reason.message ? ` (${reason.message})` : '';
    throw new ImageChestError(
      'offline',
      `Sem conexão com o Image Chest. Verifique a internet e tente de novo.${detail}`,
    );
  }
}

interface ParsedPost {
  readonly postId: string;
  readonly imageId: string;
  readonly link: string;
}

interface ParsedImage {
  readonly imageId: string;
  readonly link: string;
  readonly position: number;
}

/** Every image in a Post payload that has an Image Chest link. */
function imagesIn(body: string): ParsedImage[] {
  const data = asRecord(asRecord(parseJson(body))?.data);
  if (!data) return [];
  const images = Array.isArray(data.images) ? data.images : [];
  const parsed: ParsedImage[] = [];
  for (const [index, raw] of images.entries()) {
    const image = asRecord(raw);
    if (!image) continue;
    const link = typeof image.link === 'string' ? image.link : '';
    if (!isImageChestLink(link)) continue;
    const imageId = typeof image.id === 'string' ? image.id : '';
    if (!imageId) continue;
    const position = typeof image.position === 'number' ? image.position : index;
    parsed.push({ imageId, link, position });
  }
  return parsed;
}

/**
 * Read a Post payload and pick the image that was just added. An append returns
 * every image of the Post, so the added one is the id that was not there when
 * the Post was validated; position only breaks ties and orders a new Post.
 */
function parsePost(body: string, known: ReadonlySet<string> | null): ParsedPost | null {
  const data = asRecord(asRecord(parseJson(body))?.data);
  const postId = typeof data?.id === 'string' ? data.id : '';
  if (!postId) return null;

  const images = imagesIn(body);
  if (images.length === 0) return null;
  const fresh =
    known === null ? images : images.filter((image) => !known.has(image.imageId));
  const pool = fresh.length > 0 ? fresh : images;
  let best = pool[0];
  for (const image of pool) {
    if (image.position >= best.position) best = image;
  }
  return { postId, imageId: best.imageId, link: best.link };
}

function parseAccount(body: string): Account | null {
  const data = asRecord(asRecord(parseJson(body))?.data);
  if (!data) return null;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name) return { name };
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  return email ? { name: email } : null;
}

function failureFor(response: ImageChestResponse): ImageChestError | null {
  if (response.status === 401) return unauthorized();
  if (response.status === 413) return tooLarge();
  if (response.status === 429) {
    return rateLimited(response.retryAfterSeconds ?? 30);
  }
  if (response.status >= 400) return serverFailure(response.status);
  return null;
}

/** Check the token against the account endpoint. */
export async function testConnection(
  transport: ImageChestTransport,
  token: string,
): Promise<Account> {
  const clean = token.trim();
  if (!clean) throw noToken();

  const response = await send(transport, {
    method: 'GET',
    // The live API uses the singular `/user/me`; the docs page lists
    // `/users/me`, which 404s.
    path: '/v1/user/me',
    token: clean,
  });
  const failure = failureFor(response);
  if (failure) throw failure;
  if (response.status !== 200) throw serverFailure(response.status);

  const account = parseAccount(response.body);
  if (!account) throw malformedAccount();
  return account;
}

async function requirePost(
  transport: ImageChestTransport,
  token: string,
  postId: string,
): Promise<ReadonlySet<string>> {
  const response = await send(transport, {
    method: 'GET',
    path: `/v1/post/${encodeURIComponent(postId)}`,
    token,
  });

  if (response.status === 404) throw invalidPost(postId, 'não existe');
  if (response.status === 403) throw invalidPost(postId, 'não pode receber imagens');
  const failure = failureFor(response);
  if (failure) throw failure;
  if (response.status !== 200) throw serverFailure(response.status);
  return new Set(imagesIn(response.body).map((image) => image.imageId));
}

/**
 * Create a Post (or append to one) and return the direct cdn link. The caller
 * decides where the link goes; nothing is copied or stored here.
 */
export async function uploadStill(input: UploadInput): Promise<UploadOutcome> {
  const token = input.token.trim();
  if (!token) throw noToken();
  if (input.file.bytes.length > MAX_UPLOAD_BYTES) throw tooLarge();

  const postId = (input.postId ?? '').trim();
  if (postId && !isPostId(postId)) throw invalidPost(postId, 'não parece um id válido');
  const known = postId ? await requirePost(input.transport, token, postId) : null;

  const response = await send(input.transport, {
    method: 'POST',
    path: postId ? `/v1/post/${encodeURIComponent(postId)}/add` : '/v1/post',
    token,
    form: postId
      ? undefined
      : {
          title: input.title,
          privacy: input.privacy,
          nsfw: 'false',
        },
    file: {
      field: 'images[]',
      name: input.file.name,
      contentType: input.file.contentType,
      bytes: input.file.bytes,
    },
  });

  if (postId && response.status === 403) {
    throw invalidPost(postId, 'não é seu ou não pode receber imagens');
  }
  if (response.status === 404) {
    throw new ImageChestError(
      'server',
      'O Image Chest não aceitou o upload (404). Tente de novo.',
      404,
    );
  }
  const failure = failureFor(response);
  if (failure) throw failure;
  if (response.status !== 200 && response.status !== 201) {
    throw serverFailure(response.status);
  }

  const parsed = parsePost(response.body, known);
  if (!parsed) throw malformed();
  return { link: parsed.link, postId: parsed.postId, imageId: parsed.imageId };
}
