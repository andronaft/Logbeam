/**
 * ANSI escape codes in logs from CI runners, Docker and CLIs: `\x1b[31mERROR\x1b[0m`. They are
 * taken out of the text, so levels, times, search and filters see plain words, and their colours
 * are kept as spans for the viewer to draw.
 */

export interface AnsiSpan {
  start: number;
  end: number;
  /** Space-separated classes: ansi-red, ansi-bright-green, ansi-bold, ansi-dim, ansi-italic, ansi-underline. */
  cls: string;
}

// CSI (colours, cursor moves, erasing), OSC (window titles, hyperlinks) and two-character escapes
// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

const COLOURS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

interface Style {
  fg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

const plain = (): Style => ({ fg: null, bold: false, dim: false, italic: false, underline: false });

function classes(style: Style): string {
  const list: string[] = [];
  if (style.fg) list.push(`ansi-${style.fg}`);
  if (style.bold) list.push('ansi-bold');
  if (style.dim) list.push('ansi-dim');
  if (style.italic) list.push('ansi-italic');
  if (style.underline) list.push('ansi-underline');
  return list.join(' ');
}

/** Applies an SGR sequence ("1;31", "0", "38;5;208") to the current style. */
function applySgr(style: Style, params: string): Style {
  const codes = params === '' ? [0] : params.split(';').map((p) => (p === '' ? 0 : Number(p)));
  let next = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) next = plain();
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 22) next.bold = next.dim = false;
    else if (code === 23) next.italic = false;
    else if (code === 24) next.underline = false;
    else if (code >= 30 && code <= 37) next.fg = COLOURS[code - 30];
    else if (code >= 90 && code <= 97) next.fg = `bright-${COLOURS[code - 90]}`;
    else if (code === 39) next.fg = null;
    // 256-colour and true-colour (38;5;n, 38;2;r;g;b and the same for backgrounds): skipped, as
    // the page's own palette is used; their parameters mustn't be read as other codes
    else if (code === 38 || code === 48) i += codes[i + 1] === 5 ? 2 : codes[i + 1] === 2 ? 4 : 0;
  }
  return next;
}

/** The text without escape codes, and where its colours and styles were. */
export function parseAnsi(raw: string): { text: string; spans: AnsiSpan[] } {
  if (!raw.includes('\x1b')) return { text: raw, spans: [] };
  let text = '';
  let style = plain();
  const spans: AnsiSpan[] = [];
  let last = 0;
  const addText = (piece: string) => {
    if (!piece) return;
    const cls = classes(style);
    if (cls) {
      const previous = spans[spans.length - 1];
      if (previous && previous.end === text.length && previous.cls === cls) previous.end += piece.length;
      else spans.push({ start: text.length, end: text.length + piece.length, cls });
    }
    text += piece;
  };
  for (const match of raw.matchAll(ESCAPE)) {
    addText(raw.slice(last, match.index));
    last = match.index + match[0].length;
    if (match[2] === 'm') style = applySgr(style, match[1]);
  }
  addText(raw.slice(last));
  return { text, spans };
}

export function stripAnsi(raw: string): string {
  return raw.includes('\x1b') ? raw.replace(ESCAPE, '') : raw;
}
