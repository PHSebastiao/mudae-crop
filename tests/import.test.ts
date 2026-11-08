import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  ImportError,
  detectFormat,
  importErrorMessage,
  loadSource,
  localPathFrom,
  type Decoder,
} from '../src/core/import';
import { makeSource } from './helpers';
import type { VideoSource } from '../src/core/document';

function bytes(...head: number[]): Uint8Array {
  return new Uint8Array([...head, 0, 0, 0, 0]);
}

function riffWebp(): Uint8Array {
  return new Uint8Array([
    0x52,
    0x49,
    0x46,
    0x46, // RIFF
    0x1a,
    0x00,
    0x00,
    0x00, // size
    0x57,
    0x45,
    0x42,
    0x50, // WEBP
    0x56,
    0x50,
    0x38,
    0x20, // VP8
  ]);
}

function apng(): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type: string, data: number[] = []) => {
    const length = data.length;
    return [
      (length >>> 24) & 0xff,
      (length >>> 16) & 0xff,
      (length >>> 8) & 0xff,
      length & 0xff,
      ...type.split('').map((char) => char.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0,
    ];
  };
  return new Uint8Array([
    ...signature,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
    ...chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]),
    ...chunk('IDAT'),
    ...chunk('IEND'),
  ]);
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47);
const JPG = bytes(0xff, 0xd8, 0xff);
const GIF = bytes(0x47, 0x49, 0x46, 0x38);
const WEBP = riffWebp();
const BMP = bytes(0x42, 0x4d, 0x00);

function mp4(brand = 'isom'): Uint8Array {
  const output = new Uint8Array(24);
  output[3] = 0x18;
  output.set([0x66, 0x74, 0x79, 0x70], 4);
  output.set(
    [...brand].map((char) => char.charCodeAt(0)),
    8,
  );
  return output;
}

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);

const decodes: Decoder = async () => {
  const canvas = createCanvas(10, 10);
  return { image: canvas as unknown as CanvasImageSource, width: 10, height: 10 };
};

describe('format detection', () => {
  it('recognises PNG, JPEG, GIF and WebP from magic bytes', () => {
    expect(detectFormat(PNG)).toBe('png');
    expect(detectFormat(JPG)).toBe('jpg');
    expect(detectFormat(GIF)).toBe('gif');
    expect(detectFormat(WEBP)).toBe('webp');
  });

  it('recognises an APNG by its acTL chunk', () => {
    expect(detectFormat(apng())).toBe('apng');
  });

  it('recognises MP4, MOV and WebM containers', () => {
    expect(detectFormat(mp4())).toBe('mp4');
    expect(detectFormat(mp4('qt  '))).toBe('mov');
    expect(detectFormat(WEBM)).toBe('webm');
  });

  it('rejects anything else, whatever the extension says', () => {
    expect(detectFormat(BMP)).toBeNull();
  });
});

describe('localPathFrom', () => {
  it('accepts Windows and POSIX paths for supported media', () => {
    expect(localPathFrom('C:\\Users\\me\\Pictures\\card.png')).toBe(
      'C:\\Users\\me\\Pictures\\card.png',
    );
    expect(localPathFrom('\\\\server\\share\\clip.webm')).toBe('\\\\server\\share\\clip.webm');
    expect(localPathFrom('/home/me/pictures/card.gif')).toBe('/home/me/pictures/card.gif');
    expect(localPathFrom('./rel/card.webp')).toBe('./rel/card.webp');
  });

  it('strips the quotes Explorer and browsers wrap around a path', () => {
    expect(localPathFrom(' "C:\\Pictures\\my card.MP4" ')).toBe('C:\\Pictures\\my card.MP4');
    expect(localPathFrom("'/home/me/dog.JPG'")).toBe('/home/me/dog.JPG');
  });

  it('keeps links, scheme URLs and bare file names out', () => {
    expect(localPathFrom('https://cdn.example.com/card.png')).toBeNull();
    expect(localPathFrom('file:///C:/Pictures/card.png')).toBeNull();
    expect(localPathFrom('card.png')).toBeNull();
    expect(localPathFrom('C:\\Pictures\\notes.txt')).toBeNull();
    expect(localPathFrom('C:\\Pictures\\card.png\nextra')).toBeNull();
    expect(localPathFrom('   ')).toBeNull();
  });
});

describe('loadSource', () => {
  it('builds a Source from valid bytes and keeps the path', async () => {
    const source = await loadSource(
      { name: 'card.png', path: 'C:\\images\\card.png', bytes: PNG },
      decodes,
    );
    expect(source.name).toBe('card.png');
    expect(source.path).toBe('C:\\images\\card.png');
    expect(source.format).toBe('png');
    expect(source.width).toBe(10);
    expect(source.height).toBe(10);
  });

  it('asks the decoder for a GIF, which yields the first frame', async () => {
    const decoder = vi.fn(decodes);
    const source = await loadSource({ name: 'loop.gif', path: null, bytes: GIF }, decoder);
    expect(decoder).toHaveBeenCalledWith(expect.any(Uint8Array), 'gif');
    expect(source.format).toBe('gif');
  });

  it('imports a still WebP through the same decode path as PNG and JPG', async () => {
    const decoder = vi.fn(decodes);
    const source = await loadSource({ name: 'card.webp', path: null, bytes: WEBP }, decoder);

    expect(decoder).toHaveBeenCalledWith(WEBP, 'webp');
    expect(source.format).toBe('webp');
    expect(source.bytes).toBe(WEBP.length);
    expect(source.animation).toBeUndefined();
  });

  it('keeps a video Source from the decoder', async () => {
    const image = createCanvas(4, 4) as unknown as CanvasImageSource;
    const video: VideoSource = {
      frameCount: 24,
      fps: 12,
      durationMs: 2000,
      image,
      currentTimeMs: 0,
      seekToFrame: async () => undefined,
      seekToMs: async () => undefined,
      play: () => undefined,
      pause: () => undefined,
      dispose: () => undefined,
    };
    const decoder: Decoder = async () => ({ image, width: 4, height: 4, video });

    const source = await loadSource({ name: 'clip.mp4', path: null, bytes: mp4() }, decoder);

    expect(source.format).toBe('mp4');
    expect(source.video).toBe(video);
    expect(source.animation).toBeUndefined();
  });

  it('builds an animation from every decoded frame', async () => {
    const frame = {
      image: createCanvas(4, 4) as unknown as CanvasImageSource,
      delayMs: 80,
    };
    const decoder: Decoder = async () => ({
      image: frame.image,
      width: 4,
      height: 4,
      frames: [frame, { ...frame, delayMs: 120 }],
      loopCount: 3,
    });

    const source = await loadSource({ name: 'loop.gif', path: null, bytes: GIF }, decoder);

    expect(source.animation?.loopCount).toBe(3);
    expect(source.animation?.frames.map((entry) => entry.delayMs)).toEqual([80, 120]);
    expect(source.bytes).toBe(GIF.length);
  });

  it('names the unsupported format and suggests the accepted ones', async () => {
    const attempt = loadSource({ name: 'logo.bmp', path: null, bytes: BMP }, decodes);
    await expect(attempt).rejects.toBeInstanceOf(ImportError);
    await expect(attempt).rejects.toMatchObject({
      code: 'unsupported',
      message: 'Formato não suportado: .bmp. Use PNG, JPG, GIF, WebP, APNG, MP4, MOV ou WebM.',
    });
  });

  it('calls a mislabelled supported extension corrupt, not unsupported', async () => {
    await expect(
      loadSource({ name: 'actually-bmp.png', path: null, bytes: BMP }, decodes),
    ).rejects.toMatchObject({
      code: 'corrupt',
      message: 'Não foi possível ler "actually-bmp.png". O arquivo pode estar corrompido.',
    });
  });

  it('reports a corrupt file by name', async () => {
    const failing: Decoder = async () => {
      throw new Error('bad data');
    };
    await expect(
      loadSource({ name: 'broken.png', path: null, bytes: PNG }, failing),
    ).rejects.toMatchObject({
      code: 'corrupt',
      message: 'Não foi possível ler "broken.png". O arquivo pode estar corrompido.',
    });
  });

  it('rejects an empty file', async () => {
    await expect(
      loadSource({ name: 'zero.png', path: null, bytes: new Uint8Array() }, decodes),
    ).rejects.toMatchObject({ code: 'empty' });
  });

  it('treats a zero-sized decode as corrupt', async () => {
    const zero: Decoder = async () => ({
      image: makeSource(1, 1).image,
      width: 0,
      height: 0,
    });
    await expect(
      loadSource({ name: 'hollow.png', path: null, bytes: PNG }, zero),
    ).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('turns unknown failures into a readable message', () => {
    expect(importErrorMessage(new Error('boom'))).toBe('boom');
    expect(importErrorMessage('text')).toBe('Não foi possível abrir essa imagem.');
  });
});
