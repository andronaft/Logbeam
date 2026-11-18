import { findRegexRisk } from '../lib/regexSafety';
import { t } from '../shared/i18n';
import { workerUrl } from './workerUrl';

/** Code of searchWorker.ts, inlined at build time (see scripts/build.mjs). */
declare const __SEARCH_WORKER__: string;

const TIMEOUT_MS = 2000;

/** superseded: a newer search came before this one could start; its caller has moved on. */
export type SearchResult = { mask: Uint8Array } | { error: string } | { superseded: true };

interface Job {
  id: number;
  source: string;
  flags: string;
  resolve: (result: SearchResult) => void;
}

/**
 * Regex search over all lines with a time limit. Searches run in a worker that is killed and
 * restarted if one takes longer than TIMEOUT_MS, so a pattern like (a+)+$ can't freeze the tab.
 * One search runs at a time and only the newest waits, so typing doesn't queue up slow searches
 * and each one gets its full time. Where the page's CSP forbids workers (Chrome says so only later,
 * with an error event), it searches on the main thread, guarded only by the static check in
 * findRegexRisk.
 */
export class RegexSearch {
  private worker: Worker | null = null;
  private url: string | null = null;
  private noWorker = false;
  private nextId = 0;
  private running: (Job & { timer: ReturnType<typeof setTimeout> }) | null = null;
  private waiting: Job | null = null;

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
    return new Promise((resolve) => {
      this.waiting?.resolve({ superseded: true });
      this.waiting = { id: ++this.nextId, source, flags, resolve };
      this.next();
    });
  }

  /** Starts the waiting search when nothing runs. */
  private next(): void {
    if (this.running || !this.waiting) return;
    const job = this.waiting;
    this.waiting = null;
    const worker = this.ensureWorker();
    if (!worker) {
      job.resolve(this.searchOnMainThread(job.source, job.flags));
      return;
    }
    const timer = setTimeout(() => {
      this.running = null;
      this.restart();
      job.resolve({
        error: t('viewerRegexTimeout', 'This regex took over {seconds}s and was stopped. Simplify it.', {
          seconds: TIMEOUT_MS / 1000,
        }),
      });
      this.next();
    }, TIMEOUT_MS);
    this.running = { ...job, timer };
    worker.postMessage({ type: 'search', id: job.id, source: job.source, flags: job.flags });
  }

  private finish(result: SearchResult): void {
    const job = this.running;
    if (!job) return;
    clearTimeout(job.timer);
    this.running = null;
    job.resolve(result);
    this.next();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.noWorker) return null;
    try {
      this.url ??= workerUrl(__SEARCH_WORKER__, 'searchWorker.js');
      const worker = new Worker(this.url);
      worker.addEventListener('message', (event: MessageEvent) => {
        if (event.data.id !== this.running?.id) return;
        this.finish(event.data.error ? { error: event.data.error } : { mask: event.data.mask });
      });
      worker.addEventListener('error', (event) => {
        // the page's CSP blocked the worker: search here from now on
        event.preventDefault();
        if (worker !== this.worker) return;
        this.noWorker = true;
        this.restart();
        const job = this.running;
        if (job) this.finish(this.searchOnMainThread(job.source, job.flags));
      });
      worker.postMessage({ type: 'init', texts: this.texts });
      this.worker = worker;
      return worker;
    } catch {
      this.noWorker = true;
      return null; // CSP forbids blob: workers
    }
  }

  /** Stops the worker for good: another log was opened, or Follow replaced this search with one over more lines. */
  dispose(): void {
    if (this.running) clearTimeout(this.running.timer);
    this.running?.resolve({ superseded: true });
    this.waiting?.resolve({ superseded: true });
    this.running = this.waiting = null;
    this.restart();
    if (this.url?.startsWith('blob:')) URL.revokeObjectURL(this.url);
    this.url = null;
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
