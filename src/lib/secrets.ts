/**
 * Finds credentials that shouldn't be visible in logs, pages or pasted text:
 * cloud keys, tokens, private keys and "password=..." style assignments.
 */

import { findRegexRisk } from './regexSafety';

export interface SecretMatch {
  kind: string;
  /** Range of the secret value inside the text (for key=value pairs only the value). */
  start: number;
  end: number;
}

interface Pattern {
  kind: string;
  re: RegExp;
  /** Capture groups that may hold the secret (the first one that matched wins); [0] means the whole match. */
  groups?: number[];
}

const PATTERNS: Pattern[] = [
  { kind: 'Private key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'AWS secret key', re: /aws_secret_access_key["']?\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})/gi, groups: [1] },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'Stripe key', re: /\b(?:(?:sk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{24,}\b/g },
  { kind: 'Slack token', re: /\bxapp-\d-[A-Za-z0-9-]{20,}\b/g },
  { kind: 'Slack webhook', re: /hooks\.slack\.com\/services\/T\w+\/B\w+\/(\w{20,})/g, groups: [1] },
  { kind: 'OpenAI key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g },
  { kind: 'Anthropic key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    kind: 'API token',
    re: /\b(?:hf_[A-Za-z]{34}|GOCSPX-[\w-]{28}|ya29\.[\w-]{30,}|shp(?:at|ca|pa|ss)_[a-f0-9]{32}|pypi-AgE[\w-]{50,}|SG\.[\w-]{22}\.[\w-]{43})\b/g,
  },
  { kind: 'Azure key', re: /\bAccountKey=([A-Za-z0-9+/]{40,}={0,2})/g, groups: [1] },
  { kind: 'Azure SAS signature', re: /[?&]sig=([A-Za-z0-9%+/=]{16,})/g, groups: [1] },
  { kind: 'Cookie', re: /\b(?:Set-)?Cookie:\s*[^=;\s]+=([^;\s]{8,})/gi, groups: [1] },
  { kind: 'Docker auth', re: /"auth"\s*:\s*"([A-Za-z0-9+/]{16,}={0,2})"/g, groups: [1] },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'Bearer token', re: /\bBearer[ _]([A-Za-z0-9._~+/-]{20,}=*)/g, groups: [1] },
  { kind: 'Basic auth', re: /\bAuthorization["']?\s*[=:]\s*["']?Basic\s+([A-Za-z0-9+/]{8,}={0,2})/gi, groups: [1] },
  // scheme://user:password@host, where the password itself may contain "@" (split at the last one)
  // (redis://:password@host has no user)
  { kind: 'Password in URL', re: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@]*:([^\s/]{3,})@[^\s@/]+/gi, groups: [1] },
  // password=..., "apiKey": "...", SECRET_KEY: ..., access_token=..., with quoted values that may contain spaces
  // and escaped quotes. An unquoted value goes on past ",", ";" or "&" (password=Tr0ub4dor&3) unless another
  // key= follows (password=x&user=bob).
  // A colon must follow the key directly (YAML, JSON): "JwtTokenFilter   : Rejected …" in a Spring log is a logger name.
  {
    kind: 'Password',
    re: /\b[\w.-]{0,40}(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credentials?)[\w.-]{0,40}["']?(?:\s*=|:)\s*(?:"((?:[^"\\\n]|\\.){4,200})"|'((?:[^'\\\n]|\\.){4,200})'|([^\s"',;&}]+(?:[,;&](?![\w.-]+=)[^\s"',;&}]+)*))/gi,
    groups: [1, 2, 3],
  },
];

// The "d" flag gives exact positions of capture groups (match.indices).
const INDEXED_PATTERNS = PATTERNS.map((p) => ({ ...p, re: new RegExp(p.re.source, p.re.flags + 'd') }));

/** Values that are clearly not real secrets: placeholders, already masked values, empty-ish words. */
function isPlaceholder(value: string): boolean {
  return (
    /^\$\{.*\}?$/.test(value) || // ${DB_PASSWORD}
    /^%.*%$/.test(value) || // %PASSWORD%
    /^<.*>$/.test(value) || // <your-password>
    /^\*+$/.test(value) ||
    /\*{3,}/.test(value) ||
    /^(null|none|true|false|undefined|changeme|change-me|example|redacted|xxx+)$/i.test(value)
  );
}

// Cheap pre-check so the full pattern list only runs on lines that might contain a secret.
const HINT =
  /AKIA|ASIA|aws_secret|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|xapp-|hooks\.slack|_live_|_test_|whsec_|sk-|npm_|hf_|GOCSPX-|ya29\.|shp|pypi-|SG\.|sig=|cookie|"auth"|AIza|eyJ|bearer|basic|:\/\/[^\s/@]*:[^\s]+@|pass|pwd|secret|key|token|credential|PRIVATE/i;

let customPatterns: { kind: string; re: RegExp; groups: number[] }[] = [];

/**
 * Adds the user's own secret patterns from the settings (e.g. an internal token format). The whole
 * match is the secret, or its first group if it has one. Returns why a pattern was skipped, if any.
 */
export function setCustomSecretPatterns(patterns: { name: string; pattern: string }[]): string[] {
  const problems: string[] = [];
  customPatterns = [];
  for (const { name, pattern } of patterns) {
    if (!pattern.trim()) continue;
    const risk = findRegexRisk(pattern);
    if (risk) {
      problems.push(`${name || pattern}: ${risk}`);
      continue;
    }
    try {
      const re = new RegExp(pattern, 'gd');
      customPatterns.push({ kind: name || 'Custom secret', re, groups: [1, 0] });
    } catch (error) {
      problems.push(`${name || pattern}: ${(error as Error).message}`);
    }
  }
  return problems;
}

export function findSecrets(text: string): SecretMatch[] {
  const builtIn = HINT.test(text);
  if (!builtIn && customPatterns.length === 0) return [];
  const found: SecretMatch[] = [];
  for (const { kind, re, groups = [0] } of builtIn ? [...INDEXED_PATTERNS, ...customPatterns] : customPatterns) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const group = groups.find((g) => match[g] !== undefined);
      if (group === undefined) continue;
      const value = match[group];
      if (!value || isPlaceholder(value)) continue;
      if (kind === 'Password' && group === 3) {
        // an unquoted value: pwd=x is too short to be one; digits are a secret only under a password key
        // (password=123456), not a count (tokens_used=1234, max_tokens: 4096, tokens=1,234)
        if (value.length < 4) continue;
        if (/^[\d.,;]+$/.test(value) && !/pass|pwd|pin|secret/i.test(match[0].slice(0, match[0].length - value.length))) continue;
      }
      const [start, end] = match.indices![group]!;
      if (end > start) found.push({ kind, start, end });
    }
  }
  // Keep the earliest, then longest match where patterns overlap (a JWT is also a "Bearer token").
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const result: SecretMatch[] = [];
  for (const match of found) {
    const last = result[result.length - 1];
    if (last && match.start < last.end) continue;
    result.push(match);
  }
  return result;
}

export function hasSecret(text: string): boolean {
  return findSecrets(text).length > 0;
}

// Public, fixed prefixes that only say what kind of token it is. Keeping them reveals nothing secret.
const TYPE_PREFIX =
  /^(?:AKIA|ASIA|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|xapp-|[sr]k_(?:live|test)_|whsec_|sk-(?:proj-|svcacct-|admin-|ant-)?|npm_|hf_|GOCSPX-|ya29\.|shp(?:at|ca|pa|ss)_|pypi-|SG\.|AIza|eyJ)/;

/**
 * Replaces a secret with a fixed-length mask, so neither part of the value nor its length leaks.
 * Only a well-known type prefix (AKIA, ghp_, sk_live_…) stays visible, to tell which key it was.
 */
export function maskValue(value: string): string {
  const prefix = TYPE_PREFIX.exec(value)?.[0] ?? '';
  return prefix + '********';
}

const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;

/**
 * A field's value as Mask shows it, where the field name says what it is: password=hunter2 in a
 * table cell, the field statistics or a CSV is just "hunter2", which no pattern would catch alone.
 */
export function maskField(key: string, value: string): string {
  if (hasSecret(value)) return maskSecrets(value);
  const pair = /[\s"'&;,]/.test(value) ? `${key}=${JSON.stringify(value)}` : `${key}=${value}`;
  return hasSecret(pair) ? maskValue(value) : value;
}

export function maskSecrets(text: string): string {
  // whole private key blocks first: their base64 body isn't recognisable line by line
  let masked = text.replace(PRIVATE_KEY_BLOCK, (_, type: string) => `-----BEGIN ${type}-----\n****\n-----END ${type}-----`);
  // the BEGIN line only marks where a key is; the key itself was masked above
  const matches = findSecrets(masked).filter((m) => m.kind !== 'Private key');
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end } = matches[i];
    masked = masked.slice(0, start) + maskValue(masked.slice(start, end)) + masked.slice(end);
  }
  return masked;
}
