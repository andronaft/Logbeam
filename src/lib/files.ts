/** Reading log files the user opens or drops: plain text, or gzip (`app.log.gz`, CI artifacts). */

/** gzip files start with 1f 8b, whatever their name. */
export async function isGzip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * Text of a file, decompressed with the browser's own DecompressionStream (Chrome 80+,
 * Firefox 113+) if it's gzip. Invalid UTF-8 becomes U+FFFD instead of failing.
 */
export async function readLogFile(file: Blob): Promise<string> {
  const body = (await isGzip(file)) ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
  return new Response(body).text();
}

/** "app.log.gz" → "app.log", for the page title and file names. */
export function displayName(name: string): string {
  return name.replace(/\.gz$/i, '');
}
