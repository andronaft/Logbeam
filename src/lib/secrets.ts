/**
 * Finds credentials that shouldn't be visible in logs, pages or pasted text:
 * cloud keys, tokens, private keys and "password=..." style assignments.
 */

export interface SecretMatch {
  kind: string;
  /** Range of the secret value inside the text (for key=value pairs only the value). */
  start: number;
  end: number;
}

interface Pattern {
  kind: string;
  re: RegExp;
  /** Capture group holding the secret itself; 0 means the whole match. */
  group?: number;
}

const PATTERNS: Pattern[] = [
  { kind: 'Private key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'AWS secret key', re: /aws_secret_access_key["']?\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})/gi, group: 1 },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { kind: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'Stripe key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { kind: 'Bearer token', re: /\bBearer[ _]([A-Za-z0-9._~+/-]{20,}=*)/g, group: 1 },
  // scheme://user:password@host
  { kind: 'Password in URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]{3,})@/gi, group: 1 },
  // password=..., "apiKey": "...", DB_PASSWORD: ...
  {
    kind: 'Password',
    re: /\b[\w.-]*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)["']?\s*[=:]\s*["']?([^\s"',;&}]{4,})/gi,
    group: 1,
  },
];

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
  /AKIA|ASIA|aws_secret|gh[pousr]_|github_pat_|glpat-|xox[abprs]-|_live_|AIza|eyJ|bearer|:\/\/[^\s/@]+:[^\s@]+@|pass|pwd|secret|key|token|PRIVATE/i;

export function findSecrets(text: string): SecretMatch[] {
  if (!HINT.test(text)) return [];
  const found: SecretMatch[] = [];
  for (const { kind, re, group = 0 } of PATTERNS) {
    re.lastIndex = 0;
    for (const match of text.matchAll(re)) {
      const value = match[group];
      if (!value || isPlaceholder(value)) continue;
      const start = (match.index ?? 0) + match[0].indexOf(value);
      found.push({ kind, start, end: start + value.length });
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

/** Keeps the first 4 characters so you can still tell which key it was. */
export function maskValue(value: string): string {
  const keep = value.length > 8 ? 4 : 0;
  return value.slice(0, keep) + '*'.repeat(Math.min(Math.max(value.length - keep, 4), 16));
}

const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;

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
