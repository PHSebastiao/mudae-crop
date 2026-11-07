import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { normalizeHexColor, parseHexColor, toHexColor } from '../src/core/color';
import {
  SQUARE_FRAME,
  withBorder,
  withPadColor,
  withSharpness,
  type DocumentState,
} from '../src/core/document';
import {
  MAX_PALETTE,
  extractPalette,
  paletteFromPixels,
  type PaletteAdapter,
  type PaletteCanvas,
  type PaletteColor,
} from '../src/core/palette';
import { contextOf, makeDoc, makeSource } from './helpers';

function rgba(pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flat());
}

function hexes(palette: readonly PaletteColor[]): string[] {
  return palette.map((color) => color.hex);
}

const adapter: PaletteAdapter = {
  createCanvas(width: number, height: number): PaletteCanvas {
    const canvas = createCanvas(width, height);
    return {
      getContext: () => contextOf(canvas),
    };
  },
};

describe('hex colors', () => {
  it('normalizes with or without the hash and rejects junk', () => {
    expect(normalizeHexColor('#aabbcc')).toBe('#AABBCC');
    expect(normalizeHexColor('aabbcc')).toBe('#AABBCC');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('#abc')).toBeNull();
  });

  it('round-trips through RGB', () => {
    expect(parseHexColor('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56 });
    expect(toHexColor({ r: 0x12, g: 0x34, b: 0x56 })).toBe('#123456');
    expect(toHexColor({ r: -5, g: 300, b: 7.6 })).toBe('#00FF08');
  });
});

describe('palette', () => {
  it('ranks exact colors by coverage with a stable tie-break', () => {
    const data = rgba([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);

    const palette = paletteFromPixels(data, 5, 1, '#000000');

    expect(hexes(palette)).toEqual(['#FF0000', '#00FF00', '#0000FF', '#FFFFFF']);
    expect(palette[0].count).toBe(2);
    expect(palette[0].share).toBeCloseTo(2 / 5);
  });

  it('merges near-duplicates but still relaxes to four when the image needs it', () => {
    const data = rgba([
      [16, 16, 16, 255],
      [17, 17, 17, 255],
      [18, 18, 18, 255],
      [19, 19, 19, 255],
    ]);

    const palette = paletteFromPixels(data, 4, 1, '#000000');

    expect(palette).toHaveLength(4);
    expect(new Set(hexes(palette)).size).toBe(4);
  });

  it('returns a single swatch for a solid image instead of repeating it', () => {
    const palette = paletteFromPixels(rgba(Array(20).fill([10, 20, 30, 255])), 20, 1, '#FFFFFF');

    expect(palette).toEqual([{ hex: '#0A141E', count: 20, share: 1 }]);
  });

  it('caps a busy image at ten swatches', () => {
    const pixels: Array<[number, number, number, number]> = [];
    for (let index = 0; index < 24; index += 1) {
      pixels.push([index * 10, 255 - index * 10, (index * 37) % 255, 255]);
    }

    const palette = paletteFromPixels(rgba(pixels), 24, 1, '#000000');

    expect(palette).toHaveLength(MAX_PALETTE);
    expect(new Set(hexes(palette)).size).toBe(MAX_PALETTE);
  });

  it('composites semi-transparent pixels over the Pad color and ignores transparent ones', () => {
    const data = rgba([
      [255, 0, 0, 128],
      [0, 0, 255, 255],
      [255, 255, 255, 0],
    ]);

    const palette = paletteFromPixels(data, 3, 1, '#FFFFFF');

    expect(hexes(palette)).toContain('#FF7F7F');
    expect(hexes(palette)).toContain('#0000FF');
    expect(palette.every((color) => color.count === 1)).toBe(true);
    expect(hexes(palette)).not.toContain('#FFFFFF');
  });

  it('samples the rendered Crop without including the Border', () => {
    const source = makeSource(350, 350, (ctx) => {
      ctx.fillStyle = '#D94F6D';
      ctx.fillRect(0, 0, 175, 175);
      ctx.fillStyle = '#2B9C8F';
      ctx.fillRect(175, 0, 175, 175);
      ctx.fillStyle = '#F0D7A8';
      ctx.fillRect(0, 175, 175, 175);
      ctx.fillStyle = '#23202C';
      ctx.fillRect(175, 175, 175, 175);
    });
    const doc: DocumentState = {
      ...makeDoc(source),
      frame: SQUARE_FRAME,
    };

    const plain = extractPalette(doc, adapter);
    const bordered = extractPalette(withBorder(doc, { color: '#FF00FF', width: 20 }), adapter);

    expect(hexes(plain).sort()).toEqual(['#23202C', '#2B9C8F', '#D94F6D', '#F0D7A8'].sort());
    expect(hexes(bordered).sort()).toEqual(hexes(plain).sort());
    expect(hexes(bordered)).not.toContain('#FF00FF');
    expect(plain).toHaveLength(4);
  });

  it('composites a translucent Source over the Pad color in the rendered Crop', () => {
    const source = makeSource(225, 350, (ctx) => {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 225, 350);
    });
    const doc = withPadColor(makeDoc(source), '#FFFFFF');

    const palette = extractPalette(doc, adapter);

    expect(hexes(palette)).toContain('#FF8080');
  });

  it('keeps a flat image palette stable under sharpening', () => {
    const source = makeSource(350, 350, (ctx) => {
      ctx.fillStyle = '#D94F6D';
      ctx.fillRect(0, 0, 350, 350);
    });
    const doc: DocumentState = { ...makeDoc(source), frame: SQUARE_FRAME };

    expect(hexes(extractPalette(withSharpness(doc, 80), adapter))).toEqual(
      hexes(extractPalette(doc, adapter)),
    );
  });
});
