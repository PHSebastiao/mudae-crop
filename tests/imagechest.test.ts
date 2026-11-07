import { describe, expect, it } from 'vitest';
import {
  ImageChestError,
  MAX_UPLOAD_BYTES,
  isPostId,
  testConnection,
  uploadErrorMessage,
  uploadStill,
  type ImageChestRequest,
  type ImageChestResponse,
  type ImageChestTransport,
  type UploadFile,
} from '../src/core/imagechest';

interface ScriptedTransport {
  readonly requests: ImageChestRequest[];
  readonly transport: ImageChestTransport;
}

function script(responses: Array<ImageChestResponse | Error>): ScriptedTransport {
  const requests: ImageChestRequest[] = [];
  return {
    requests,
    transport: {
      async send(request) {
        requests.push(request);
        const next = responses.shift();
        if (!next) throw new Error('unexpected request');
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function ok(body: unknown, status = 200): ImageChestResponse {
  return { status, body: JSON.stringify(body), retryAfterSeconds: null };
}

function image(id: string, position: number, link = `https://cdn.imgchest.com/files/${id}.png`) {
  return { id, link, position };
}

function post(id: string, images: ReturnType<typeof image>[]) {
  return { data: { id, images } };
}

const file: UploadFile = {
  name: 'card.png',
  contentType: 'image/png',
  bytes: new Uint8Array([1, 2, 3, 4]),
};

const base = {
  token: 'secret-token',
  file,
  title: 'cat · 225×350',
  privacy: 'hidden' as const,
};

describe('uploadStill', () => {
  it('creates a hidden post and returns the direct cdn link', async () => {
    const { transport, requests } = script([
      ok(post('post123', [image('img1', 1)]), 201),
    ]);

    const outcome = await uploadStill({ ...base, transport });

    expect(outcome).toEqual({
      link: 'https://cdn.imgchest.com/files/img1.png',
      postId: 'post123',
      imageId: 'img1',
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/post');
    expect(request.token).toBe('secret-token');
    expect(request.form).toEqual({
      title: 'cat · 225×350',
      privacy: 'hidden',
      nsfw: 'false',
    });
    expect(request.file).toMatchObject({
      field: 'images[]',
      name: 'card.png',
      contentType: 'image/png',
    });
    expect(Array.from(request.file?.bytes ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('appends to an existing Post only after validating it', async () => {
    const { transport, requests } = script([
      ok(post('post123', [image('old', 1)])),
      ok(
        post('post123', [image('old', 1), image('new', 2)]),
      ),
    ]);

    const outcome = await uploadStill({ ...base, transport, postId: 'post123' });

    expect(outcome.link).toBe('https://cdn.imgchest.com/files/new.png');
    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/v1/post/post123'],
      ['POST', '/v1/post/post123/add'],
    ]);
    // Appending never renames the Post or changes its privacy.
    expect(requests[1].form).toBeUndefined();
    expect(requests[1].file?.field).toBe('images[]');
  });

  it('picks the newest image when the response lists the whole Post', async () => {
    const { transport } = script([
      ok(
        post('post123', [
          image('a', 1),
          image('c', 3),
          image('b', 2),
        ]),
      ),
    ]);

    const outcome = await uploadStill({ ...base, transport });

    expect(outcome.imageId).toBe('c');
  });

  it('finds the appended image by id even when the response is not position-ordered', async () => {
    const { transport } = script([
      ok(post('post123', [image('old', 1)])),
      // The added image comes first and the old one claims a higher position.
      ok(post('post123', [image('new', 1), image('old', 9)])),
    ]);

    const outcome = await uploadStill({ ...base, transport, postId: 'post123' });

    expect(outcome.imageId).toBe('new');
    expect(outcome.link).toBe('https://cdn.imgchest.com/files/new.png');
  });

  it('rejects an unknown Post id before uploading', async () => {
    const { transport, requests } = script([{ ...ok({ message: 'Not found' }, 404) }]);

    const error = await uploadStill({ ...base, transport, postId: 'nope' }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ImageChestError);
    expect((error as ImageChestError).code).toBe('invalid-post');
    expect((error as ImageChestError).message).toContain('nope');
    expect(requests).toHaveLength(1);
  });

  it('rejects a malformed Post id without any request', async () => {
    const { transport, requests } = script([]);

    const error = await uploadStill({ ...base, transport, postId: '../evil' }).catch(
      (reason: unknown) => reason,
    );

    expect((error as ImageChestError).code).toBe('invalid-post');
    expect(requests).toHaveLength(0);
  });

  it('reports the account name on a token check', async () => {
    const { transport, requests } = script([
      ok({ data: { name: 'LunarLandr', email: 'l@example.com' } }),
    ]);

    const account = await testConnection(transport, 'secret-token');

    expect(account.name).toBe('LunarLandr');
    expect(requests[0].method).toBe('GET');
    expect(requests[0].path).toBe('/v1/users/me');
  });
});

describe('upload failures', () => {
  it('maps 401 to an unauthorized error that points at Configurações', async () => {
    const { transport } = script([ok({}, 401)]);

    const error = await uploadStill({ ...base, transport }).catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('unauthorized');
    expect(uploadErrorMessage(error)).toContain('Configurações');
  });

  it('maps 413 to the 30 MB explanation', async () => {
    const { transport } = script([ok({}, 413)]);

    const error = await uploadStill({ ...base, transport }).catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('too-large');
    expect(uploadErrorMessage(error)).toContain('30 MB');
  });

  it('maps 429 to a backoff with the Retry-After seconds', async () => {
    const { transport } = script([
      { ...ok({}, 429), retryAfterSeconds: 42 },
    ]);

    const error = await uploadStill({ ...base, transport }).catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('rate-limited');
    expect((error as ImageChestError).retryAfterSeconds).toBe(42);
    expect(uploadErrorMessage(error)).toContain('42s');
  });

  it('maps a thrown transport rejection to an offline error', async () => {
    const { transport } = script([new Error('connection refused')]);

    const error = await uploadStill({ ...base, transport }).catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('offline');
    expect(uploadErrorMessage(error)).toContain('Sem conexão');
  });

  it('maps a success body without a direct link to malformed', async () => {
    const { transport } = script([ok({ data: { id: 'post123', images: [] } })]);

    const error = await uploadStill({ ...base, transport }).catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('malformed');
  });

  it('refuses a file above the Image Chest limit before sending it', async () => {
    const { transport, requests } = script([]);
    const huge: UploadFile = {
      ...file,
      bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
    };

    const error = await uploadStill({ ...base, transport, file: huge }).catch(
      (reason: unknown) => reason,
    );

    expect((error as ImageChestError).code).toBe('too-large');
    expect(requests).toHaveLength(0);
  });

  it('refuses an upload without a token', async () => {
    const { transport, requests } = script([]);

    const error = await uploadStill({ ...base, token: '  ', transport }).catch(
      (reason: unknown) => reason,
    );

    expect((error as ImageChestError).code).toBe('no-token');
    expect(requests).toHaveLength(0);
  });

  it('reports a rejected token check specifically', async () => {
    const { transport } = script([ok({}, 401)]);

    const error = await testConnection(transport, 'bad').catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('unauthorized');
    expect((error as ImageChestError).message).toContain('recusado');
  });

  it('reports a token check that returns no account data', async () => {
    const { transport } = script([ok({ data: {} })]);

    const error = await testConnection(transport, 'token').catch((reason: unknown) => reason);

    expect((error as ImageChestError).code).toBe('malformed');
    expect((error as ImageChestError).message).toContain('conta');
  });
});

describe('isPostId', () => {
  it('accepts Image Chest ids and rejects anything path-like', () => {
    expect(isPostId('3qe4gdvj4j2')).toBe(true);
    expect(isPostId('')).toBe(false);
    expect(isPostId('../post')).toBe(false);
    expect(isPostId('a b')).toBe(false);
  });
});
