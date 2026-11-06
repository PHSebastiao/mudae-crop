import { describe, expect, it, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
  ImportError,
  detectFormat,
  importErrorMessage,
  loadSource,
  type Decoder,
} from '../src/core/import';
import { makeSource } from './helpers';

function bytes(...head: number[]): Uint8Array {
  return new Uint8Array([...head, 0, 0, 0, 0]);
}

const PNG = bytes(0x89, 0x50, 0x4e, 0x47);
const JPG = bytes(0xff, 0xd8, 0xff);
const GIF = bytes(0x47, 0x49, 0x46, 0x38);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46);

const decodes: Decoder = async () => {
  const canvas = createCanvas(10, 10);
  return { image: canvas as unknown as CanvasImageSource, width: 10, height: 10 };
};

describe('format detection', () => {
  it('recognises PNG, JPEG and GIF from magic bytes', () => {
    expect(detectFormat(PNG)).toBe('png');
    expect(detectFormat(JPG)).toBe('jpg');
    expect(detectFormat(GIF)).toBe('gif');
  });

  it('rejects anything else, whatever the extension says', () => {
    expect(detectFormat(WEBP)).toBeNull();
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

  it('names the unsupported format and suggests the accepted ones', async () => {
    const attempt = loadSource({ name: 'logo.webp', path: null, bytes: WEBP }, decodes);
    await expect(attempt).rejects.toBeInstanceOf(ImportError);
    await expect(attempt).rejects.toMatchObject({
      code: 'unsupported',
      message: 'Formato não suportado: .webp. Use PNG, JPG ou GIF.',
    });
  });

  it('calls a mislabelled supported extension corrupt, not unsupported', async () => {
    await expect(
      loadSource({ name: 'actually-webp.png', path: null, bytes: WEBP }, decodes),
    ).rejects.toMatchObject({
      code: 'corrupt',
      message: 'Não foi possível ler "actually-webp.png". O arquivo pode estar corrompido.',
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
