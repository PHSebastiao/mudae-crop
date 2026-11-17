/**
 * The Image Chest API v1 surface the upload path needs. Everything here is
 * pure: the native transport turns an ImageChestRequest into an HTTP call, so
 * the request shape, the error wording and the link extraction stay testable
 * without a network.
 *
 * Docs: https://imgchest.com/docs/api/1.0/endpoints/post
 */
import { MAX_UPLOAD_FILE_BYTES } from './limits';
import { asRecord, parseJson } from './json';
import { text, textOf, type TextRef } from './i18n/text';
import type { MessageKey } from './i18n/messages.pt-BR';

export type Privacy = 'public' | 'hidden' | 'secret';

/** The privacy values Image Chest accepts; the label is UI copy, not data. */
export const PRIVACY_VALUES: ReadonlyArray<Privacy> = ['hidden', 'public', 'secret'];

/** Where Image Chest hands out the personal API token. */
export const IMAGE_CHEST_API_KEY_URL = 'https://imgchest.com/profile/api';

/**
 * The Image Chest per-file ceiling for an upload. The docs put it at 20 MB,
 * independently of the account tier; the app's download ceiling is larger.
 */
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_FILE_BYTES;

export interface UploadFile {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

export interface ImageChestRequest {
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly path: string;
  readonly token: string;
  /** Scalar fields: multipart on a POST, form-urlencoded on a PUT. */
  readonly form?: Readonly<Record<string, string>>;
  /** The file parts of a POST. Image Chest takes many per request. */
  readonly files?: readonly ImageChestFilePart[];
}

export interface ImageChestFilePart {
  readonly field: string;
  readonly name: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
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
  readonly text: TextRef;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    code: ImageChestErrorCode,
    message: TextRef,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message.key);
    this.name = 'ImageChestError';
    this.code = code;
    this.text = message;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface Account {
  readonly name: string;
  /** True for a Gold account; null when the reply does not say. */
  readonly gold: boolean | null;
}

export interface UploadOutcome {
  readonly link: string;
  readonly postId: string;
  readonly imageId: string;
  /** False when the image went up but its description did not. */
  readonly described: boolean;
}

/** One uploaded image as the Post reply described it. */
export interface UploadedImage {
  readonly imageId: string;
  readonly link: string;
}

export interface UploadBatchOutcome {
  readonly postId: string;
  /** Every image this request added, in Post order. */
  readonly images: readonly UploadedImage[];
  readonly described: boolean;
  /**
   * Every image id the Post holds after this request, the ones that were
   * already there included. A later chunk passes it back so the append can skip
   * the validation GET and still tell its own images from the older ones.
   */
  readonly knownImages: ReadonlySet<string>;
}

export interface UploadInput {
  readonly transport: ImageChestTransport;
  readonly token: string;
  readonly file: UploadFile;
  readonly title: string;
  readonly privacy: Privacy;
  /** Written into the uploaded image's description, best effort. */
  readonly description?: string;
  /** When set, the Export is appended to this Post after validating it. */
  readonly postId?: string | null;
}

export interface UploadBatchInput {
  readonly transport: ImageChestTransport;
  readonly token: string;
  readonly files: readonly UploadFile[];
  readonly title: string;
  readonly privacy: Privacy;
  /** Written into the first image of the request, best effort. */
  readonly description?: string;
  readonly postId?: string | null;
  /**
   * The image ids the caller knows the Post already holds, normally the
   * `knownImages` of the previous chunk. Supplying it skips the validation GET;
   * leaving it out keeps the validation for a Post this batch has not seen.
   */
  readonly knownImages?: ReadonlySet<string>;
}

export function isPostId(value: string): boolean {
  return /^[A-Za-z0-9]{1,32}$/.test(value);
}

/** An uploaded image id; the same alphabet as a Post id, naming a file. */
function isImageId(value: string): boolean {
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

export function uploadErrorMessage(error: unknown): TextRef {
  return textOf(error) ?? text('imagechest.uploadFailed');
}

function unauthorized(): ImageChestError {
  return new ImageChestError('unauthorized', text('imagechest.unauthorized'), 401);
}

function noToken(): ImageChestError {
  return new ImageChestError('no-token', text('imagechest.noToken'));
}

function tooLarge(name?: string): ImageChestError {
  return name
    ? new ImageChestError('too-large', text('imagechest.tooLargeNamed', { name }), 413)
    : new ImageChestError('too-large', text('imagechest.tooLarge'), 413);
}

function rateLimited(seconds: number): ImageChestError {
  return new ImageChestError(
    'rate-limited',
    text('imagechest.rateLimited', { seconds }),
    429,
    seconds,
  );
}

function serverFailure(status: number): ImageChestError {
  return new ImageChestError('server', text('imagechest.serverFailure', { status }), status);
}

function malformed(): ImageChestError {
  return new ImageChestError('malformed', text('imagechest.malformed'));
}

function malformedAccount(): ImageChestError {
  return new ImageChestError('malformed', text('imagechest.malformedAccount'));
}

function invalidPost(postId: string, reason: MessageKey): ImageChestError {
  return new ImageChestError('invalid-post', { key: reason, params: { postId } }, 404);
}

async function send(
  transport: ImageChestTransport,
  request: ImageChestRequest,
): Promise<ImageChestResponse> {
  try {
    return await transport.send(request);
  } catch (reason) {
    if (reason instanceof ImageChestError) throw reason;
    const detail =
      textOf(reason) ??
      (reason instanceof Error && reason.message ? reason.message : text('common.unknownCause'));
    throw new ImageChestError('offline', text('imagechest.offline', { detail }));
  }
}

interface ParsedPost {
  readonly postId: string;
  readonly images: UploadedImage[];
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
 * Read a Post payload and list the images this request added. An append returns
 * every image of the Post, so the new ones are the ids that were not there when
 * the Post was validated; position orders them, and a brand-new Post is
 * entirely new.
 */
function parsePost(body: string, known: ReadonlySet<string> | null): ParsedPost | null {
  const data = asRecord(asRecord(parseJson(body))?.data);
  const postId = typeof data?.id === 'string' ? data.id : '';
  if (!postId) return null;

  const images = imagesIn(body);
  if (images.length === 0) return null;
  const fresh = known === null ? images : images.filter((image) => !known.has(image.imageId));
  // An append that brings nothing new did not add our file. Falling back to the
  // older images would report someone else's link as the one just uploaded.
  if (known !== null && fresh.length === 0) return null;
  const pool = (fresh.length > 0 ? fresh : images)
    .slice()
    .sort((left, right) => left.position - right.position);
  return {
    postId,
    images: pool.map((image) => ({ imageId: image.imageId, link: image.link })),
  };
}

function parseAccount(body: string): Account | null {
  const data = asRecord(asRecord(parseJson(body))?.data);
  if (!data) return null;
  // The account payload is the only place that says whether the tier is Gold;
  // a reply without the field leaves the stored value alone.
  const gold = typeof data.is_subscribed === 'boolean' ? data.is_subscribed : null;
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name) return { name, gold };
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  return email ? { name: email, gold } : null;
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

  if (response.status === 404) throw invalidPost(postId, 'imagechest.postMissing');
  if (response.status === 403) throw invalidPost(postId, 'imagechest.postNoImages');
  const failure = failureFor(response);
  if (failure) throw failure;
  if (response.status !== 200) throw serverFailure(response.status);
  return new Set(imagesIn(response.body).map((image) => image.imageId));
}

/**
 * A Post has no description field, so the credit line goes on the uploaded
 * image, the only place Image Chest stores one. The Post already exists by
 * now: a rejected description must never lose the link, so this reports
 * failure instead of throwing.
 */
async function describeImage(
  transport: ImageChestTransport,
  token: string,
  imageId: string,
  description: string,
): Promise<boolean> {
  if (!isImageId(imageId)) return false;
  try {
    const response = await send(transport, {
      method: 'PUT',
      path: `/v1/file/${encodeURIComponent(imageId)}`,
      token,
      form: { description },
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

/**
 * Create a Post (or append to one) with one or more images and report every
 * image the request added, in Post order. The caller decides where the links
 * go; nothing is copied or stored here.
 *
 * The description goes on the first image only: a Post has no description
 * field, so the credit line lives on the image, and one credit per Post is the
 * rule the app promises.
 */
export async function uploadBatch(input: UploadBatchInput): Promise<UploadBatchOutcome> {
  const token = input.token.trim();
  if (!token) throw noToken();
  if (input.files.length === 0) {
    throw new ImageChestError('malformed', text('imagechest.noFiles'));
  }
  for (const file of input.files) {
    if (file.bytes.length > MAX_UPLOAD_BYTES) throw tooLarge(file.name);
  }

  const postId = (input.postId ?? '').trim();
  if (postId && !isPostId(postId)) throw invalidPost(postId, 'imagechest.postInvalid');
  const known = postId
    ? (input.knownImages ?? (await requirePost(input.transport, token, postId)))
    : null;

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
    files: input.files.map((file) => ({
      field: 'images[]',
      name: file.name,
      contentType: file.contentType,
      bytes: file.bytes,
    })),
  });

  if (postId && response.status === 403) {
    throw invalidPost(postId, 'imagechest.postNotYours');
  }
  if (response.status === 404) {
    // Appending to a Post that no longer exists is a bad Post id, not a server
    // hiccup — and it must never look like a reason to demote a Gold account.
    if (postId) throw invalidPost(postId, 'imagechest.postMissing');
    throw new ImageChestError('server', text('imagechest.notAccepted'), 404);
  }
  const failure = failureFor(response);
  if (failure) throw failure;
  if (response.status !== 200 && response.status !== 201) {
    throw serverFailure(response.status);
  }

  const parsed = parsePost(response.body, known);
  if (!parsed) throw malformed();
  // An append must describe exactly the files it added: a filtered image would
  // shift every later link onto the wrong Tile. A create may list extras, but
  // never fewer than it received.
  if (known !== null && parsed.images.length !== input.files.length) throw malformed();
  if (parsed.images.length < input.files.length) throw malformed();
  const description = (input.description ?? '').trim();
  const first = parsed.images[0];
  const described =
    description && first
      ? await describeImage(input.transport, token, first.imageId, description)
      : false;
  // The next chunk of the same Post gets this back: it is everything the Post
  // holds now, so an append can skip the validation GET and still filter the
  // reply down to the files it just sent.
  const knownImages = new Set<string>(known ?? []);
  for (const image of parsed.images) knownImages.add(image.imageId);
  return { postId: parsed.postId, images: parsed.images, described, knownImages };
}

/** One image: the batch path, narrowed to the single link the caller copies. */
export async function uploadStill(input: UploadInput): Promise<UploadOutcome> {
  const outcome = await uploadBatch({
    transport: input.transport,
    token: input.token,
    files: [input.file],
    title: input.title,
    privacy: input.privacy,
    description: input.description,
    postId: input.postId,
  });
  const image = outcome.images[outcome.images.length - 1];
  if (!image) throw malformed();
  return {
    link: image.link,
    postId: outcome.postId,
    imageId: image.imageId,
    described: outcome.described,
  };
}
