/**
 * The platform deflate for the PNG writer. `CompressionStream('deflate')` is
 * the native zlib already in the WebView (and in Node), so the Export pays no
 * extra dependency: only the row filters are ours. The stream is drained while
 * it is written, so a large raster never waits on backpressure.
 */
export async function deflateZlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // Both sides run together: `Promise.all` subscribes to each one, so a failure
  // on either side is handled instead of surfacing as an unhandled rejection.
  const writing = writer.write(data).then(() => writer.close());
  const [pieces] = await Promise.all([readAll(stream.readable), writing]);

  const total = pieces.reduce((length, piece) => length + piece.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
}

async function readAll(readable: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const pieces: Uint8Array[] = [];
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pieces.push(value);
  }
  return pieces;
}
