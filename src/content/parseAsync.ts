import { LogLine, LogParser, ParseOptions, splitLines } from '../lib/logs';
import { workerUrl } from './workerUrl';

/** Code of parseWorker.ts, inlined at build time (see scripts/build.mjs). */
declare const __PARSE_WORKER__: string;

/** Below this size parsing takes a few milliseconds and isn't worth a worker. */
const ASYNC_THRESHOLD = 1_000_000;
const MAIN_THREAD_CHUNK = 10_000;

export type Progress = (done: number, total: number) => void;

/** How the last log was parsed; exposed on <html data-logbeam-parser> for tests and debugging. */
function mark(method: 'sync' | 'worker' | 'chunks'): void {
  document.documentElement.dataset.logbeamParser = method;
}

/**
 * Parses big logs without freezing the tab. A content script can't start a worker from the
 * extension's URL (it's another origin), so the worker is created from a Blob. Pages whose
 * CSP forbids blob: workers fall back to parsing on the main thread in chunks, yielding
 * between them so the progress bar keeps moving.
 */
export async function parseLogAsync(text: string, onProgress: Progress, options: ParseOptions = {}): Promise<LogLine[]> {
  if (text.length < ASYNC_THRESHOLD) {
    mark('sync');
    return new LogParser(options).push(splitLines(text));
  }
  try {
    const lines = await parseInWorker(text, onProgress, options);
    mark('worker');
    return lines;
  } catch {
    mark('chunks');
    return parseInChunks(text, onProgress, options);
  }
}

function parseInWorker(text: string, onProgress: Progress, options: ParseOptions): Promise<LogLine[]> {
  return new Promise((resolve, reject) => {
    const url = workerUrl(__PARSE_WORKER__, 'parseWorker.js');
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch (e) {
      URL.revokeObjectURL(url);
      reject(e);
      return;
    }
    const finish = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'progress') {
        onProgress(event.data.done, event.data.total);
      } else if (event.data.type === 'done') {
        finish();
        resolve(event.data.lines);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new Error(event.message || 'Worker failed'));
    };
    worker.postMessage({ text, options });
  });
}

async function parseInChunks(text: string, onProgress: Progress, options: ParseOptions): Promise<LogLine[]> {
  const rawLines = splitLines(text);
  const parser = new LogParser(options);
  const lines: LogLine[] = [];
  for (let i = 0; i < rawLines.length; i += MAIN_THREAD_CHUNK) {
    lines.push(...parser.push(rawLines.slice(i, i + MAIN_THREAD_CHUNK)));
    onProgress(Math.min(i + MAIN_THREAD_CHUNK, rawLines.length), rawLines.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return lines;
}
