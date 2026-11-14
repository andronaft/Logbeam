/**
 * The part of the address after # that keeps a view of the log, so a shared link opens the same
 * view: the selected line or range of lines, and what narrows the log (levels, search, time
 * range, pods).
 *
 *   #L120                                   one line, as in links from older versions
 *   #L120-L135                              a range of lines
 *   #L120&levels=ERROR,WARN&q=payments      a line and filters
 *   #q=timeout&re=1&from=1700000000000&to=1700000600000&pods=api-6f9c
 *
 * Anything else after # (a page's own anchor) is not a view and is left alone.
 */

export const LINK_LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'OTHER'] as const;
/** A level chip of the viewer; OTHER is the lines without a level. */
export type LinkLevel = (typeof LINK_LEVELS)[number];

export interface ViewLink {
  /** The selected line, or the first line of a selected range. */
  line: number | null;
  /** The last line of a range (#L120-L135); null for one line. */
  lineEnd: number | null;
  /** Only these levels are shown; null when none is switched off. */
  levels: LinkLevel[] | null;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  /** Only entries in this time range, in epoch millis: from (included) to (not included). */
  timeRange: [number, number] | null;
  /** Only these pods or containers are shown; null unless the link lists them. */
  pods: string[] | null;
  /** These pods or containers are switched off: the other way to say it, when that is shorter. */
  hiddenPods: string[] | null;
}

export const EMPTY_VIEW: ViewLink = {
  line: null,
  lineEnd: null,
  levels: null,
  query: '',
  regex: false,
  caseSensitive: false,
  timeRange: null,
  pods: null,
  hiddenPods: null,
};

const LINES = /^L(\d{1,9})(?:-L?(\d{1,9}))?$/;
const PAIR = /^([a-z]+)=(.*)$/s;
const TIME = /^\d{1,15}$/;

/**
 * Percent-encodes a value. Stricter than encodeURIComponent, because chat apps and Markdown cut
 * a link at ")" or "'"; but ":", "/" and "=" stay readable (level=error, pod/api-6f9c/app).
 */
function encode(value: string): string {
  // half of a surrogate pair (text cut in the middle of an emoji) can't be encoded
  return encodeURIComponent(value.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�'))
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(3A|2F|3D)/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // a lone % typed by hand
    return value;
  }
}

const list = (value: string): string[] => (value === '' ? [] : value.split(',').map(decode));

/** Reads a view from location.hash. Null when the hash isn't one of ours. */
export function parseViewLink(hash: string): ViewLink | null {
  const parts = hash.replace(/^#/, '').split('&');
  const view: ViewLink = { ...EMPTY_VIEW };
  let from: number | null = null;
  let to: number | null = null;
  // a hash is ours when it has a line or at least one key we know
  let ours = false;

  const lines = LINES.exec(parts[0]);
  if (lines) {
    parts.shift();
    const first = Number(lines[1]);
    const last = lines[2] === undefined ? first : Number(lines[2]);
    if (first > 0 && last > 0) {
      view.line = Math.min(first, last);
      view.lineEnd = first === last ? null : Math.max(first, last);
    }
    ours = true;
  }

  for (const part of parts) {
    const pair = PAIR.exec(part);
    // "#installation" or "#step:5:12": someone else's anchor
    if (!pair) return null;
    const [, key, value] = pair;
    switch (key) {
      case 'levels': {
        const wanted = new Set(list(value).map((level) => level.toUpperCase()));
        view.levels = LINK_LEVELS.filter((level) => wanted.has(level));
        break;
      }
      case 'q':
        view.query = decode(value);
        break;
      case 're':
        view.regex = value === '1';
        break;
      case 'case':
        view.caseSensitive = value === '1';
        break;
      case 'from':
        from = TIME.test(value) ? Number(value) : null;
        break;
      case 'to':
        to = TIME.test(value) ? Number(value) : null;
        break;
      case 'pods':
        view.pods = list(value);
        break;
      case 'hide':
        view.hiddenPods = list(value);
        break;
      default:
        // a key from a newer version: skipped, so the rest of the link still works
        continue;
    }
    ours = true;
  }
  if (from !== null && to !== null && to > from) view.timeRange = [from, to];
  return ours ? view : null;
}

/** Writes a view as a hash: "#L120&levels=ERROR", or "" when there is nothing to keep. */
export function formatViewLink(view: ViewLink): string {
  const parts: string[] = [];
  if (view.line !== null && view.line > 0) {
    const end = view.lineEnd !== null && view.lineEnd !== view.line ? view.lineEnd : null;
    parts.push(end === null ? `L${view.line}` : `L${Math.min(view.line, end)}-L${Math.max(view.line, end)}`);
  }
  if (view.levels) parts.push(`levels=${view.levels.join(',')}`);
  if (view.query) {
    parts.push(`q=${encode(view.query)}`);
    if (view.regex) parts.push('re=1');
    if (view.caseSensitive) parts.push('case=1');
  }
  if (view.timeRange) parts.push(`from=${Math.round(view.timeRange[0])}`, `to=${Math.round(view.timeRange[1])}`);
  if (view.pods) parts.push(`pods=${view.pods.map(encode).join(',')}`);
  else if (view.hiddenPods?.length) parts.push(`hide=${view.hiddenPods.map(encode).join(',')}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
