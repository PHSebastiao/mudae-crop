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
  WHITE_SWATCH,
  extractPalette,
  paletteFromPixels,
  withWhiteFirst,
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

describe('vibrant accents', () => {
  it('keeps a small vivid red and pink when neutral areas dominate', () => {
    const neutrals: Array<[number, number, number]> = [
      [20, 20, 20],
      [60, 55, 50],
      [100, 95, 90],
      [140, 135, 130],
      [180, 175, 170],
      [220, 215, 210],
      [240, 240, 240],
      [90, 70, 50],
    ];
    const counts = [3000, 2600, 2200, 1800, 1400, 1200, 1000, 800];
    const pixels: Array<[number, number, number, number]> = [];
    neutrals.forEach((rgb, index) => {
      for (let i = 0; i < counts[index]; i += 1) {
        pixels.push([rgb[0], rgb[1], rgb[2], 255]);
      }
    });
    for (let i = 0; i < 220; i += 1) pixels.push([190, 25, 20, 255]);
    for (let i = 0; i < 180; i += 1) pixels.push([205, 40, 130, 255]);

    const palette = paletteFromPixels(rgba(pixels), pixels.length, 1, '#FFFFFF');
    const rgb = palette.map((color) => parseHexColor(color.hex)!);

    expect(rgb.some((color) => color.r > 150 && color.g < 80 && color.b < 80)).toBe(true);
    expect(rgb.some((color) => color.r > 150 && color.g < 100 && color.b > 90)).toBe(true);
  });

  it('always puts the fixed white first and drops the extracted white duplicate', () => {
    const palette = [
      { hex: '#D94F6D', count: 10, share: 0.5 },
      { hex: '#FFFFFF', count: 5, share: 0.25 },
      { hex: '#2B9C8F', count: 5, share: 0.25 },
    ];

    const ordered = withWhiteFirst(palette);

    expect(ordered[0]).toEqual(WHITE_SWATCH);
    expect(ordered[0].hex).toBe('#FFFFFF');
    expect(ordered.filter((color) => color.hex === '#FFFFFF')).toHaveLength(1);
    expect(ordered.map((color) => color.hex)).toEqual(['#FFFFFF', '#D94F6D', '#2B9C8F']);
  });

  it('caps the white-first list at ten swatches', () => {
    const many: PaletteColor[] = Array.from({ length: 14 }, (_, index) => ({
      hex: `#${(index * 111111).toString(16).padStart(6, '0').slice(-6)}`,
      count: 1,
      share: 0,
    }));

    expect(withWhiteFirst(many)).toHaveLength(MAX_PALETTE);
  });
});

describe('white-first filtering', () => {
  it('drops a near-white palette color beside the fixed white', () => {
    const ordered = withWhiteFirst([
      { hex: '#FEFEFE', count: 10, share: 0.5 },
      { hex: '#F5FFFF', count: 5, share: 0.25 },
      { hex: '#D94F6D', count: 10, share: 0.5 },
    ]);

    expect(ordered.map((color) => color.hex)).toEqual(['#FFFFFF', '#D94F6D']);
  });
});

describe('near-white boundary', () => {
  it('keeps a color just below the near-white threshold', () => {
    const ordered = withWhiteFirst([
      { hex: '#F4FFFF', count: 5, share: 0.5 },
      { hex: '#D94F6D', count: 5, share: 0.5 },
    ]);

    expect(ordered.map((color) => color.hex)).toEqual(['#FFFFFF', '#F4FFFF', '#D94F6D']);
  });
});
