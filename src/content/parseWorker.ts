import { LogParser, ParseOptions, splitLines } from '../lib/logs';

/**
 * Parses a log off the main thread, reporting progress between chunks.
 * Messages in: { text, options }. Messages out: { type: 'progress', done, total } and { type: 'done', lines }.
 */
const CHUNK = 20_000;

// minimal worker-scope typing; the project compiles against the DOM lib
const ctx = self as unknown as {
  onmessage: (event: MessageEvent<{ text: string; options?: ParseOptions }>) => void;
  postMessage(message: unknown): void;
};

ctx.onmessage = (event) => {
  const rawLines = splitLines(event.data.text);
  const parser = new LogParser(event.data.options);
  const lines = [];
  for (let i = 0; i < rawLines.length; i += CHUNK) {
    lines.push(...parser.push(rawLines.slice(i, i + CHUNK)));
    ctx.postMessage({ type: 'progress', done: Math.min(i + CHUNK, rawLines.length), total: rawLines.length });
  }
  ctx.postMessage({ type: 'done', lines });
};
