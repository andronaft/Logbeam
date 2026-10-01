import { describe, expect, it } from 'vitest';
import { findSecrets, hasSecret, maskSecrets, maskValue } from '../src/lib/secrets';

// Token-shaped fixtures are assembled at runtime so secret scanners (GitHub push protection)
// don't mistake this test file for a leak. None of them are real credentials.
const fake = (...parts: string[]) => parts.join('');
const GITHUB_TOKEN = fake('ghp', '_', '0123456789abcdefghijklmnopqrstuvwxyzAB');
const SLACK_TOKEN = fake('xoxb', '-1234567890-', 'abcdefghij');
const STRIPE_KEY = fake('sk', '_live_', '4eC39HqLyjWDarjtT1zdp7dc');
const GOOGLE_KEY = fake('AIza', 'SyA1234567890abcdefghijklmnopqrstuv');

const kinds = (text: string) => findSecrets(text).map((m) => m.kind);
const values = (text: string) => findSecrets(text).map((m) => text.slice(m.start, m.end));

describe('findSecrets', () => {
  it('finds cloud and service keys', () => {
    expect(kinds('key AKIAIOSFODNN7EXAMPLE used')).toEqual(['AWS access key']);
    expect(kinds('aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toEqual(['AWS secret key']);
    expect(kinds(`token ${GITHUB_TOKEN}`)).toEqual(['GitHub token']);
    expect(kinds(SLACK_TOKEN)).toEqual(['Slack token']);
    expect(kinds(STRIPE_KEY)).toEqual(['Stripe key']);
    expect(kinds(GOOGLE_KEY)).toEqual(['Google API key']);
    expect(kinds('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['Private key']);
    expect(kinds('-----BEGIN PRIVATE KEY-----')).toEqual(['Private key']);
  });

  it('finds only the value of password assignments', () => {
    expect(values('spring.datasource.password=32adc7e0827e7fbe15f3')).toEqual(['32adc7e0827e7fbe15f3']);
    expect(values('{"apiKey": "abcd1234efgh"}')).toEqual(['abcd1234efgh']);
    expect(values('DB_PASSWORD: hunter22')).toEqual(['hunter22']);
    expect(values('jwt.token.secret=zuk-secret')).toEqual(['zuk-secret']);
  });

  it('finds framework and OAuth style secrets', () => {
    expect(values('SECRET_KEY=django-insecure-abc123')).toEqual(['django-insecure-abc123']);
    expect(values('access_token=ya29.a0AfH6SMBx')).toEqual(['ya29.a0AfH6SMBx']);
    expect(values('refresh_token: 1//0gLrefresh')).toEqual(['1//0gLrefresh']);
    expect(values('token=abcdef123456')).toEqual(['abcdef123456']);
    expect(values('private_key = "MIIEvQIBADAN"')).toEqual(['MIIEvQIBADAN']);
    expect(values('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toEqual(['dXNlcjpwYXNzd29yZA==']);
  });

  it('ignores counters and logger names that only look like secrets', () => {
    expect(hasSecret('tokens_used=1234 prompt_tokens=88')).toBe(false);
    expect(hasSecret('WARN 4242 --- [main] c.z.security.JwtTokenFilter              : Rejected expired JWT')).toBe(false);
    expect(hasSecret('INFO o.s.s.web.PasswordEncoderConfig : Using BCrypt')).toBe(false);
  });

  it('finds passwords inside connection URLs', () => {
    expect(values('jdbc:postgresql://admin:s3cretPass@db:5432/app')).toEqual(['s3cretPass']);
    expect(kinds('postgres://user:pa55word@localhost/db')).toEqual(['Password in URL']);
  });

  it('prefers the JWT over the generic bearer token', () => {
    const header = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbm5hIn0.c2lnbmF0dXJlMTIz';
    expect(kinds(header)).toEqual(['JWT']);
  });

  it('ignores placeholders and masked values', () => {
    expect(hasSecret('spring.datasource.password=${DB_PASSWORD}')).toBe(false);
    expect(hasSecret('password=***REMOVED***')).toBe(false);
    expect(hasSecret('password: <your-password>')).toBe(false);
    expect(hasSecret('password=changeme')).toBe(false);
    expect(hasSecret('Password must be at least 8 characters long')).toBe(false);
    expect(hasSecret('INFO user logged in, status=200')).toBe(false);
  });
});

describe('maskSecrets', () => {
  it('masks values completely, keeping only a public type prefix', () => {
    expect(maskSecrets('password=hunter2hunter2 user=anna')).toBe('password=******** user=anna');
    expect(maskSecrets('key AKIAIOSFODNN7EXAMPLE')).toBe('key AKIA********');
    expect(maskSecrets(`token ${GITHUB_TOKEN}`)).toBe('token ghp_********');
    expect(maskSecrets('postgres://user:pa55word@localhost/db')).toBe('postgres://user:********@localhost/db');
  });

  it("doesn't leak the length of a secret", () => {
    expect(maskSecrets('password=abcd')).toBe(maskSecrets('password=abcdefghijklmnopqrstuvwxyz'));
  });

  it('masks quoted values with spaces and passwords containing @', () => {
    expect(maskSecrets('{"password": "p@ss word long"}')).toBe('{"password": "********"}');
    expect(maskSecrets("password='open sesame'")).toBe("password='********'");
    expect(maskSecrets('postgres://u:p@ss@host:5432/db')).toBe('postgres://u:********@host:5432/db');
  });

  it('masks whole private key blocks', () => {
    const pem = 'before\n-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBase64Body\nMoreBody==\n-----END EC PRIVATE KEY-----\nafter';
    expect(maskSecrets(pem)).toBe('before\n-----BEGIN EC PRIVATE KEY-----\n****\n-----END EC PRIVATE KEY-----\nafter');
  });

  it('leaves clean text alone', () => {
    expect(maskSecrets('nothing to see here')).toBe('nothing to see here');
  });

  it('masks short values completely', () => {
    expect(maskValue('abc12')).toBe('********');
  });
});
