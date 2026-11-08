import { describe, expect, it, vi } from 'vitest';
import { loadSource } from '../src/core/import';
import {
  DownloadError,
  DownloadTransportError,
  MAX_DOWNLOAD_BYTES,
  downloadErrorMessage,
  downloadSource,
  formatBytes,
  sourceNameFromUrl,
  sourceUrlFrom,
  type DownloadHandle,
  type DownloadProgress,
  type DownloadResult,
  type DownloadTransport,
} from '../src/core/download';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);

interface FakeScript {
  readonly bytes?: Uint8Array;
  readonly contentType?: string | null;
  readonly contentLength?: number | null;
  readonly progress?: readonly DownloadProgress[];
  readonly failure?: DownloadTransportError;
  readonly finalUrl?: string;
}

function fakeTransport(script: FakeScript = {}) {
  let cancels = 0;
  const transport: DownloadTransport = {
    start(url, onProgress): DownloadHandle {
      let cancelled = false;
      const result = (async (): Promise<DownloadResult> => {
        for (const progress of script.progress ?? []) {
          if (cancelled) throw new DownloadTransportError('cancelled', 'cancelado');
          onProgress(progress);
          await Promise.resolve();
        }
        if (script.failure) throw script.failure;
        if (cancelled) throw new DownloadTransportError('cancelled', 'cancelado');
        return {
          bytes: script.bytes ?? new Uint8Array(),
          contentType: script.contentType ?? null,
          contentLength: script.contentLength ?? null,
          finalUrl: script.finalUrl ?? url,
        };
      })();
      return {
        result,
        cancel() {
          cancelled = true;
          cancels += 1;
        },
      };
    },
  };
  return { transport, cancels: () => cancels };
}

describe('sourceUrlFrom', () => {
  it('accepts a bare http(s) link, including Discord angle brackets', () => {
    expect(sourceUrlFrom('  <https://cdn.example.com/a.png>  ')?.href).toBe(
      'https://cdn.example.com/a.png',
    );
    expect(sourceUrlFrom('http://example.com/card.gif?x=1')?.href).toBe(
      'http://example.com/card.gif?x=1',
    );
  });

  it('refuses text, other schemes and a missing scheme', () => {
    expect(sourceUrlFrom('veja https://example.com/a.png')).toBeNull();
    expect(sourceUrlFrom('ftp://example.com/a.png')).toBeNull();
    expect(sourceUrlFrom('example.com/a.png')).toBeNull();
    expect(sourceUrlFrom('   ')).toBeNull();
  });
});

describe('sourceNameFromUrl', () => {
  const name = (raw: string, format: 'png' | 'jpg' | 'gif') =>
    sourceNameFromUrl(new URL(raw), format);

  it('keeps a usable file name and drops the query and fragment', () => {
    expect(name('https://cdn.example.com/path/card%20one.png?token=1#x', 'png')).toBe(
      'card one.png',
    );
  });

  it('adds the sniffed extension when the link has none', () => {
    expect(name('https://cdn.example.com/image?id=42', 'gif')).toBe('image.gif');
    expect(name('https://cdn.example.com/', 'png')).toBe('link.png');
  });

  it('replaces an extension that is not an image one', () => {
    expect(name('https://cdn.example.com/get.php', 'png')).toBe('get.png');
  });

  it('aligns a known extension with the format the bytes actually are', () => {
    expect(name('https://cdn.example.com/card.gif', 'png')).toBe('card.png');
    expect(name('https://cdn.example.com/card.jpeg', 'jpg')).toBe('card.jpeg');
  });
});

describe('downloadSource', () => {
  it('turns a link into a named Source candidate without decoding it', async () => {
    const { transport } = fakeTransport({
      bytes: PNG,
      contentType: 'image/png',
      contentLength: PNG.length,
    });

    const candidate = await downloadSource('https://cdn.example.com/path/card.png?token=1', {
      transport,
    });

    expect(candidate).toEqual({ name: 'card.png', path: null, bytes: PNG });
  });

  it('names the Source from the final URL after a redirect', async () => {
    const { transport } = fakeTransport({
      bytes: PNG,
      contentType: 'image/png',
      finalUrl: 'https://cdn.example.com/real/card.png',
    });

    const candidate = await downloadSource('https://short.example.com/abc', { transport });

    expect(candidate.name).toBe('card.png');
  });

  it('keeps an animated GIF as bytes for the normal import path', async () => {
    const { transport } = fakeTransport({ bytes: GIF, contentType: 'image/gif' });
    const candidate = await downloadSource('https://cdn.example.com/loop.gif', { transport });
    expect(candidate.name).toBe('loop.gif');
    expect(candidate.bytes).toBe(GIF);
  });

  it('feeds the downloaded bytes into the normal Source import', async () => {
    const { transport } = fakeTransport({ bytes: GIF, contentType: 'image/gif' });
    const candidate = await downloadSource('https://cdn.example.com/loop.gif', { transport });
    const decoder = vi.fn(async () => ({
      image: {} as CanvasImageSource,
      width: 12,
      height: 8,
    }));

    const source = await loadSource(candidate, decoder);

    expect(decoder).toHaveBeenCalledWith(GIF, 'gif');
    expect(source.name).toBe('loop.gif');
    expect(source.path).toBeNull();
    expect(source.format).toBe('gif');
  });

  it('forwards received bytes and the reported total', async () => {
    const { transport } = fakeTransport({
      bytes: PNG,
      progress: [
        { received: 4, total: 10 },
        { received: 10, total: 10 },
      ],
    });
    const onProgress = vi.fn();

    await downloadSource('https://cdn.example.com/a.png', { transport, onProgress });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { received: 4, total: 10 },
      { received: 10, total: 10 },
    ]);
  });

  it('refuses a URL that is not http(s) before starting a transport', async () => {
    const start = vi.fn();
    const transport: DownloadTransport = { start };

    await expect(downloadSource('card.png', { transport })).rejects.toMatchObject({
      code: 'invalid-url',
      message: 'O link precisa começar com http:// ou https://.',
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('names an unreachable host', async () => {
    const { transport } = fakeTransport({
      failure: new DownloadTransportError('unreachable', 'dns error'),
    });

    await expect(
      downloadSource('https://missing.example.com/card.png', { transport }),
    ).rejects.toMatchObject({
      code: 'unreachable',
      message: 'Não foi possível alcançar missing.example.com. Verifique a conexão ou o link.',
    });
  });

  it('names a 404 and carries the status', async () => {
    const { transport } = fakeTransport({
      failure: new DownloadTransportError('http', 'not found', 404),
    });

    const attempt = downloadSource('https://cdn.example.com/gone.png', { transport });

    await expect(attempt).rejects.toBeInstanceOf(DownloadError);
    await expect(attempt).rejects.toMatchObject({
      code: 'http',
      status: 404,
      message: 'O link não existe (404). Confira o endereço.',
    });
  });

  it('rejects an HTML page that is not an image', async () => {
    const { transport } = fakeTransport({
      bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
      contentType: 'text/html; charset=utf-8',
    });

    await expect(downloadSource('https://example.com/page', { transport })).rejects.toMatchObject({
      code: 'not-image',
      message:
        'O link não aponta para uma imagem ou vídeo (text/html). Use um link direto para PNG, JPG, GIF, WebP, MP4, MOV ou WebM.',
    });
  });

  it('rejects bytes that sniff as neither PNG, JPG nor GIF', async () => {
    const { transport } = fakeTransport({
      bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      contentType: 'application/octet-stream',
    });

    await expect(
      downloadSource('https://cdn.example.com/mystery', { transport }),
    ).rejects.toMatchObject({
      code: 'not-image',
      message:
        'O link cdn.example.com não devolveu uma imagem ou vídeo reconhecido. Use um link direto para o arquivo.',
    });
  });

  it('rejects an empty response', async () => {
    const { transport } = fakeTransport({ contentType: 'image/png' });
    await expect(
      downloadSource('https://cdn.example.com/zero.png', { transport }),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('cancels promptly when the user aborts', async () => {
    const script = fakeTransport({
      bytes: PNG,
      progress: [
        { received: 2, total: 10 },
        { received: 6, total: 10 },
      ],
    });
    const controller = new AbortController();

    const attempt = downloadSource('https://cdn.example.com/slow.png', {
      transport: script.transport,
      signal: controller.signal,
    });
    controller.abort();

    await expect(attempt).rejects.toMatchObject({
      code: 'cancelled',
      message: 'Download cancelado.',
    });
    expect(script.cancels()).toBeGreaterThan(0);
  });

  it('stops a download whose reported total is over the ceiling', async () => {
    const script = fakeTransport({
      bytes: PNG,
      contentType: 'image/png',
      progress: [{ received: 0, total: 64 }],
    });
    const onProgress = vi.fn();

    await expect(
      downloadSource('https://cdn.example.com/huge.gif', {
        transport: script.transport,
        onProgress,
        maxBytes: 32,
      }),
    ).rejects.toMatchObject({ code: 'too-large' });

    expect(script.cancels()).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledWith({ received: 0, total: 64 });
  });

  it('rejects a body over the ceiling before decoding', async () => {
    const { transport } = fakeTransport({
      bytes: new Uint8Array(64).fill(0x89),
      contentType: 'image/png',
    });

    await expect(
      downloadSource('https://cdn.example.com/huge.png', { transport, maxBytes: 32 }),
    ).rejects.toMatchObject({ code: 'too-large' });
  });

  it('measures the product ceiling in bytes', () => {
    expect(MAX_DOWNLOAD_BYTES).toBe(30 * 1024 * 1024);
  });
});

describe('presentation helpers', () => {
  it('formats byte counts for the progress readout', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(MAX_DOWNLOAD_BYTES)).toBe('30.0 MB');
  });

  it('falls back to a readable message for unknown failures', () => {
    expect(downloadErrorMessage(new Error('boom'))).toBe('boom');
    expect(downloadErrorMessage('text')).toBe('Não foi possível baixar essa imagem.');
  });
});
