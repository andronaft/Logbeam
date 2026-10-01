import { explainCron } from './cron';
import { findSecrets, maskSecrets } from './secrets';

export interface Transform {
  id: string;
  title: string;
  /** Label for the small popup buttons. */
  short: string;
  /** Returns the transformed text; throws an Error with a readable message if the input doesn't fit. */
  apply: (input: string) => string;
}

/**
 * Pretty-prints JSON without round-tripping it through JS numbers: JSON.parse would turn the
 * snowflake id 12345678901234567890 into 12345678901234567000 and 1.10 into 1.1. The input is
 * validated with JSON.parse, then re-indented token by token, copying every literal verbatim.
 */
export function formatJson(input: string): string {
  return reformatJson(input, '  ');
}

export function minifyJson(input: string): string {
  return reformatJson(input, null);
}

function reformatJson(input: string, indent: string | null): string {
  const text = input.trim();
  parseJson(text); // throws a readable error for invalid input
  let out = '';
  let depth = 0;
  const newline = () => (indent === null ? '' : '\n' + indent.repeat(depth));
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '{' || c === '[') {
      // keep empty objects and arrays on one line
      let j = i + 1;
      while (/\s/.test(text[j])) j++;
      if (text[j] === (c === '{' ? '}' : ']')) {
        out += c + text[j];
        i = j;
      } else {
        depth++;
        out += c + newline();
      }
    } else if (c === '}' || c === ']') {
      depth--;
      out += newline() + c;
    } else if (c === ',') {
      out += ',' + newline();
    } else if (c === ':') {
      out += indent === null ? ':' : ': ';
    } else if (!/\s/.test(c)) {
      out += c; // numbers, true, false, null: copied as written
    }
  }
  return out;
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input.trim());
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
}

/** UTF-8 safe Base64. */
export function base64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** Accepts both standard and URL-safe Base64, with or without padding. */
export function base64Decode(input: string): string {
  const normalized = input.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Not valid Base64');
  }
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('Not valid Base64');
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export function urlEncode(input: string): string {
  return encodeURIComponent(input);
}

export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input.replace(/\+/g, ' '));
  } catch {
    throw new Error('Not a valid URL-encoded string');
  }
}

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
}

export function decodeJwt(input: string): DecodedJwt {
  const token = input.trim().replace(/^Bearer[_ ]/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('A JWT has three dot-separated parts');
  }
  const decodePart = (part: string, name: string) => {
    try {
      return JSON.parse(base64Decode(part)) as Record<string, unknown>;
    } catch {
      throw new Error(`JWT ${name} is not Base64url-encoded JSON`);
    }
  };
  return {
    header: decodePart(parts[0], 'header'),
    payload: decodePart(parts[1], 'payload'),
    signaturePresent: parts[2].length > 0,
  };
}

/** Human-readable JWT: header, payload, and the registered time claims as dates with "expired" status. */
export function describeJwt(input: string, now: number = Date.now()): string {
  const { header, payload, signaturePresent } = decodeJwt(input);
  const lines = ['// header', JSON.stringify(header, null, 2), '// payload', JSON.stringify(payload, null, 2)];
  const claims: string[] = [];
  // RFC 7519 dates are seconds; some issuers wrongly put milliseconds there
  const looksLikeMillis = (value: number) => value > 1e11;
  for (const claim of ['iat', 'nbf', 'exp'] as const) {
    const value = payload[claim];
    if (typeof value === 'number') {
      const millis = looksLikeMillis(value) ? value : value * 1000;
      const note = looksLikeMillis(value) ? '  (looks like milliseconds; JWT dates should be seconds)' : '';
      claims.push(`${claim}: ${new Date(millis).toISOString()}${note}`);
    }
  }
  if (typeof payload.exp === 'number') {
    const left = (looksLikeMillis(payload.exp) ? payload.exp : payload.exp * 1000) - now;
    claims.push(left > 0 ? `valid for another ${formatDuration(left)}` : `EXPIRED ${formatDuration(-left)} ago`);
  }
  if (claims.length > 0) {
    lines.push('// claims', ...claims);
  }
  lines.push(signaturePresent ? '// signature present (not verified: the key is unknown)' : '// no signature (alg "none"?)');
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Converts between Unix time and dates: "1700000000" (seconds), "1700000000000" (millis)
 * or any date string Date.parse understands.
 */
export function convertTimestamp(input: string): string {
  const trimmed = input.trim();
  if (/^-?\d{1,19}(\.\d+)?$/.test(trimmed)) {
    const value = Number(trimmed);
    // guess the unit from the size: seconds, millis, micros (Go, Postgres) or nanos (OpenTelemetry)
    const [unit, millis] =
      Math.abs(value) < 1e11
        ? ['seconds', value * 1000]
        : Math.abs(value) < 1e14
          ? ['milliseconds', value]
          : Math.abs(value) < 1e17
            ? ['microseconds', value / 1000]
            : ['nanoseconds', value / 1e6];
    const date = new Date(millis);
    if (Number.isNaN(date.getTime())) {
      throw new Error('Not a valid timestamp');
    }
    return [`UTC:   ${date.toISOString()}`, `Local: ${date.toString()}`, `(read as ${unit})`].join('\n');
  }
  const millis = Date.parse(trimmed);
  if (Number.isNaN(millis)) {
    throw new Error('Not a Unix timestamp or a date');
  }
  return [`seconds: ${Math.floor(millis / 1000)}`, `millis:  ${millis}`, `UTC:     ${new Date(millis).toISOString()}`].join('\n');
}

/** Splits "someText", "some_text", "some-text", "Some Text" into ["some", "text"]. */
export function words(input: string): string[] {
  return input
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export const toCamelCase = (s: string) =>
  words(s)
    .map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
export const toSnakeCase = (s: string) => words(s).join('_');
export const toKebabCase = (s: string) => words(s).join('-');
export const toConstantCase = (s: string) => words(s).join('_').toUpperCase();

/** Lines without CRLF leftovers; a final line break is remembered rather than sorted as an empty line. */
function toLines(input: string): { lines: string[]; trailingNewline: boolean } {
  const normalized = input.replace(/\r\n?/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  return { lines: (trailingNewline ? normalized.slice(0, -1) : normalized).split('\n'), trailingNewline };
}

export function sortLines(input: string): string {
  const { lines, trailingNewline } = toLines(input);
  return lines.sort((a, b) => a.localeCompare(b)).join('\n') + (trailingNewline ? '\n' : '');
}

export function uniqueLines(input: string): string {
  const { lines, trailingNewline } = toLines(input);
  return [...new Set(lines)].join('\n') + (trailingNewline ? '\n' : '');
}

/** Masks keys, tokens and passwords, e.g. before pasting a log or config into a chat. */
export function maskSecretsTransform(input: string): string {
  if (findSecrets(input).length === 0 && !/PRIVATE KEY-----/.test(input)) {
    throw new Error('No secrets found');
  }
  return maskSecrets(input);
}

export const TRANSFORMS: Transform[] = [
  { id: 'mask-secrets', short: 'Mask secrets', title: 'Mask secrets (keys, tokens, passwords)', apply: maskSecretsTransform },
  { id: 'json-format', short: 'Format JSON', title: 'Format JSON', apply: formatJson },
  { id: 'json-minify', short: 'Minify JSON', title: 'Minify JSON', apply: minifyJson },
  { id: 'jwt-decode', short: 'Decode JWT', title: 'Decode JWT', apply: (s) => describeJwt(s) },
  { id: 'base64-encode', short: 'To Base64', title: 'Base64 encode', apply: base64Encode },
  { id: 'base64-decode', short: 'From Base64', title: 'Base64 decode', apply: base64Decode },
  { id: 'url-encode', short: 'URL encode', title: 'URL encode', apply: urlEncode },
  { id: 'url-decode', short: 'URL decode', title: 'URL decode', apply: urlDecode },
  { id: 'timestamp', short: 'Timestamp', title: 'Timestamp ⇄ date', apply: convertTimestamp },
  { id: 'cron', short: 'Explain cron', title: 'Explain cron expression', apply: explainCron },
  { id: 'camel', short: 'camelCase', title: 'camelCase', apply: toCamelCase },
  { id: 'snake', short: 'snake_case', title: 'snake_case', apply: toSnakeCase },
  { id: 'kebab', short: 'kebab-case', title: 'kebab-case', apply: toKebabCase },
  { id: 'constant', short: 'CONSTANT', title: 'CONSTANT_CASE', apply: toConstantCase },
  { id: 'sort-lines', short: 'Sort lines', title: 'Sort lines', apply: sortLines },
  { id: 'unique-lines', short: 'Unique lines', title: 'Remove duplicate lines', apply: uniqueLines },
];

export function findTransform(id: string): Transform | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}
