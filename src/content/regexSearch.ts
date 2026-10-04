import { findRegexRisk } from '../lib/regexSafety';
import { workerUrl } from './workerUrl';

/** Code of searchWorker.ts, inlined at build time (see scripts/build.mjs). */
declare const __SEARCH_WORKER__: string;

const TIMEOUT_MS = 2000;

export type SearchResult = { mask: Uint8Array } | { error: string };

/**
 * Regex search over all lines with a time limit. Searches run in a worker that is killed and
 * restarted if one takes longer than TIMEOUT_MS, so a pattern like (a+)+$ can't freeze the tab.
 * Where the page's CSP forbids workers, it searches on the main thread, guarded only by the
 * static check in findRegexRisk.
 */
export class RegexSearch {
  private worker: Worker | null = null;
  private url: string | null = null;
  private nextId = 0;

  constructor(private readonly texts: string[]) {}

  async search(source: string, caseSensitive: boolean): Promise<SearchResult> {
    const risk = findRegexRisk(source);
    if (risk) return { error: risk };
    const flags = caseSensitive ? '' : 'i';
    try {
      new RegExp(source, flags);
    } catch (e) {
      return { error: (e as Error).message };
    }

    const worker = this.ensureWorker();
    if (!worker) return this.searchOnMainThread(source, flags);

    const id = ++this.nextId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        cleanup();
        this.restart();
        resolve({ error: `This regex took over ${TIMEOUT_MS / 1000}s and was stopped. Simplify it.` });
      }, TIMEOUT_MS);
      const onMessage = (event: MessageEvent) => {
        if (event.data.id !== id) return;
        cleanup();
        resolve(event.data.error ? { error: event.data.error } : { mask: event.data.mask });
      };
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'search', id, source, flags });
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.url ??= workerUrl(__SEARCH_WORKER__, 'searchWorker.js');
      this.worker = new Worker(this.url);
      this.worker.postMessage({ type: 'init', texts: this.texts });
      return this.worker;
    } catch {
      return null; // CSP forbids blob: workers
    }
  }

  private restart(): void {
    this.worker?.terminate();
    this.worker = null; // a fresh worker is created (and sent the texts) on the next search
  }

  private searchOnMainThread(source: string, flags: string): SearchResult {
    const re = new RegExp(source, flags);
    const mask = new Uint8Array(this.texts.length);
    for (let i = 0; i < this.texts.length; i++) {
      if (re.test(this.texts[i])) mask[i] = 1;
    }
    return { mask };
  }
}
