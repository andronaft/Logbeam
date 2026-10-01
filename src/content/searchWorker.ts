/**
 * Runs regex searches off the main thread. The viewer can terminate this worker when a search
 * takes too long (catastrophic backtracking); a RegExp running on the main thread can't be stopped.
 * Messages in: { type: 'init', texts } once, then { type: 'search', id, source, flags }.
 * Messages out: { id, mask: Uint8Array } with 1 for matching lines, or { id, error }.
 */
const ctx = self as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

let texts: string[] = [];

ctx.onmessage = (event) => {
  const data = event.data;
  if (data.type === 'init') {
    texts = data.texts;
    return;
  }
  let re: RegExp;
  try {
    re = new RegExp(data.source, data.flags);
  } catch (e) {
    ctx.postMessage({ id: data.id, error: (e as Error).message });
    return;
  }
  const mask = new Uint8Array(texts.length);
  for (let i = 0; i < texts.length; i++) {
    if (re.test(texts[i])) mask[i] = 1;
  }
  ctx.postMessage({ id: data.id, mask }, [mask.buffer]);
};
