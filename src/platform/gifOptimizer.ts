import type { GifOptimizer, OptimizeCompression } from '../core/optimize';

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function commandFor(options: OptimizeCompression): string {
  const parts = [`-O${Math.min(3, Math.max(1, options.level))}`];
  if (options.lossy > 0) parts.push(`--lossy=${Math.round(options.lossy)}`);
  if (options.colors !== null) parts.push(`--colors=${Math.round(options.colors)}`);
  parts.push('in.gif', '-o', '/out/out.gif');
  return parts.join(' ');
}

/**
 * The platform's real lossy compressor. It runs gifsicle in a WebView2 worker,
 * so the core target-size loop stays pure and testable with a fake.
 */
export const gifsicleOptimizer: GifOptimizer = {
  async compress(bytes, options) {
    const { default: gifsicle } = await import('gifsicle-wasm-browser');
    const outputs = await gifsicle.run({
      input: [{ file: arrayBufferOf(bytes), name: 'in.gif' }],
      command: [commandFor(options)],
      isStrict: true,
    });
    const output = outputs?.[0];
    if (!output) throw new Error('gifsicle não devolveu um GIF.');
    return new Uint8Array(await output.arrayBuffer());
  },
};
