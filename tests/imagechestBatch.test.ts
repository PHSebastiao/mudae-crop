import { describe, expect, it } from 'vitest';
import {
  ImageChestError,
  MAX_UPLOAD_BYTES,
  testConnection,
  uploadBatch,
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

function file(name: string, bytes: number[] = [1, 2, 3]): UploadFile {
  return { name, contentType: 'image/png', bytes: new Uint8Array(bytes) };
}

const base = {
  token: 'secret-token',
  title: 'cat · 225×350',
  description: 'Cropped with [Mudae Crop](https://github.com/PHSebastiao/mudae-crop/)',
  privacy: 'hidden' as const,
};

describe('uploadBatch', () => {
  it('sends every file in one request and reports them in Post order', async () => {
    const { transport, requests } = script([
      ok(post('post1', [image('a', 2), image('b', 1)])),
      ok({ success: 'true' }),
    ]);

    const outcome = await uploadBatch({
      ...base,
      transport,
      files: [file('one.png'), file('two.png')],
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].path).toBe('/v1/post');
    expect(requests[0].files).toHaveLength(2);
    expect(requests[0].files?.map((part) => part.field)).toEqual(['images[]', 'images[]']);
    expect(requests[0].files?.map((part) => part.name)).toEqual(['one.png', 'two.png']);
    // Position orders the reply, so the caller can zip files with images.
    expect(outcome.images.map((entry) => entry.imageId)).toEqual(['b', 'a']);
    expect(outcome.postId).toBe('post1');
    expect(outcome.described).toBe(true);
  });

  it('writes the description on the first image only', async () => {
    const { transport, requests } = script([
      ok(post('post1', [image('a', 1), image('b', 2)])),
      ok({ success: 'true' }),
    ]);

    await uploadBatch({ ...base, transport, files: [file('one.png'), file('two.png')] });

    expect(requests.filter((request) => request.method === 'PUT')).toHaveLength(1);
    expect(requests[1].path).toBe('/v1/file/a');
  });

  it('appends to an existing Post after validating it', async () => {
    const { transport, requests } = script([
      ok(post('post9', [image('old', 1)])),
      ok(post('post9', [image('old', 1), image('new', 2), image('newer', 3)])),
    ]);

    const outcome = await uploadBatch({
      ...base,
      transport,
      postId: 'post9',
      description: '',
      files: [file('one.png'), file('two.png')],
    });

    expect(requests.map((request) => [request.method, request.path])).toEqual([
      ['GET', '/v1/post/post9'],
      ['POST', '/v1/post/post9/add'],
    ]);
    expect(requests[1].form).toBeUndefined();
    expect(outcome.images.map((entry) => entry.imageId)).toEqual(['new', 'newer']);
  });

  it('refuses an oversized file before any request', async () => {
    const { transport, requests } = script([]);
    const huge: UploadFile = {
      name: 'huge.png',
      contentType: 'image/png',
      bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1),
    };

    await expect(
      uploadBatch({ ...base, transport, files: [file('ok.png'), huge] }),
    ).rejects.toThrow(/20 MB/);
    expect(requests).toHaveLength(0);
  });

  it('refuses an empty batch', async () => {
    const { transport } = script([]);
    await expect(uploadBatch({ ...base, transport, files: [] })).rejects.toThrow(/Nenhum arquivo/);
  });
});

describe('testConnection', () => {
  it('reads the Gold flag from is_subscribed', async () => {
    const { transport } = script([ok({ data: { name: 'someone', is_subscribed: true } })]);
    const account = await testConnection(transport, 'token');
    expect(account).toEqual({ name: 'someone', gold: true });
  });

  it('leaves the tier unknown when the reply does not say', async () => {
    const { transport } = script([ok({ data: { name: 'someone' } })]);
    const account = await testConnection(transport, 'token');
    expect(account.gold).toBeNull();
  });
});

describe('append failures', () => {
  it('maps a 404 on an append to an invalid Post', async () => {
    const { transport } = script([
      ok(post('post9', [image('old', 1)])),
      { status: 404, body: '{}', retryAfterSeconds: null },
    ]);

    const error = await uploadBatch({
      ...base,
      transport,
      postId: 'post9',
      files: [file('one.png')],
    }).catch((reason) => reason);

    expect(error).toBeInstanceOf(ImageChestError);
    expect((error as ImageChestError).code).toBe('invalid-post');
  });

  it('refuses an append that added nothing instead of reporting an old image', async () => {
    const { transport } = script([
      ok(post('post9', [image('old', 1)])),
      ok(post('post9', [image('old', 1)])),
    ]);

    await expect(
      uploadBatch({
        ...base,
        transport,
        postId: 'post9',
        description: '',
        files: [file('one.png')],
      }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });
});
