import { describe, expect, it } from 'vitest';
import { bookmarkReport, toCsv } from '../src/lib/insights';
import { parseLog } from '../src/lib/logs';
import { findSecrets, maskField, maskSecrets } from '../src/lib/secrets';

const a = (n: number, c = 'a') => c.repeat(n);

describe('secret formats', () => {
  const samples: [string, string][] = [
    ['OpenAI project key', `OPENAI_KEY sk-proj-${a(48, 'Ab1')}`],
    ['OpenAI legacy key', `key sk-${a(20, 'x')}T3BlbkFJ${a(20, 'y')}`],
    ['Anthropic key', `using sk-ant-api03-${a(90, 'Z')}`],
    ['npm token', `npm_${a(36, 'q')}`],
    ['Hugging Face', `hf_${a(34, 'k')}`],
    ['Google OAuth secret', `GOCSPX-${a(28, 'g')}`],
    ['Shopify', `shpat_${a(32, 'f')}`],
    ['SendGrid', `SG.${a(22, 's')}.${a(43, 't')}`],
    ['Stripe test key', `sk_test_${a(24, 'r')}`],
    ['Stripe webhook secret', `whsec_${a(24, 'w')}`],
    ['Slack app token', `xapp-1-${a(24, 'B')}`],
    ['Slack webhook', `POST https://hooks.slack.com/services/T0001/B0002/${a(24, 'h')}`],
    ['Azure account key', `DefaultEndpointsProtocol=https;AccountName=x;AccountKey=${a(44, 'K')}==;EndpointSuffix=core`],
    ['Azure SAS', `GET https://x.blob.core.windows.net/c/f?sv=2022&sp=r&sig=${a(30, 'S')}%3D`],
    ['Cookie', 'Set-Cookie: JSESSIONID=0123456789ABCDEF; Path=/'],
    ['Docker auth', `{"auths":{"ghcr.io":{"auth":"${a(24, 'Y')}="}}}`],
    ['Redis URL without a user', 'connecting to redis://:s3cr3tpass@cache:6379/0'],
  ];
  for (const [name, text] of samples) {
    it(`finds ${name}`, () => {
      expect(findSecrets(text).length, text).toBeGreaterThan(0);
      expect(maskSecrets(text)).toContain('********');
    });
  }

  it('leaves ordinary words alone', () => {
    for (const text of ['task-runner started', 'risk-free sk-8 refactor', 'Cookie policy accepted', 'npm install done']) {
      expect(findSecrets(text), text).toEqual([]);
    }
  });
});

describe('unquoted values', () => {
  it('masks a password with & or ; in it, all of it', () => {
    expect(maskSecrets('password=Tr0ub4dor&3xyz')).toBe('password=********');
    expect(maskSecrets('password=abcdef;ghijk end')).toBe('password=******** end');
  });

  it('stops at the next key=', () => {
    expect(maskSecrets('password=abcdef&user=bob')).toBe('password=********&user=bob');
    expect(maskSecrets('password=secret123, user=bob')).toBe('password=********, user=bob');
  });

  it('masks a numeric password but not a count', () => {
    expect(maskSecrets('password=123456')).toBe('password=********');
    expect(maskSecrets('db_password: 8675309')).toBe('db_password: ********');
    expect(maskSecrets('tokens_used=1234 max_tokens: 4096')).toBe('tokens_used=1234 max_tokens: 4096');
  });
});

describe('field values', () => {
  it('masks a value by its field name', () => {
    expect(maskField('password', 'hunter2-Real!')).toBe('********');
    expect(maskField('session_token', 'abc def ghi')).toBe('********');
    expect(maskField('status', '200')).toBe('200');
    expect(maskField('note', `ghp_${a(36, 'z')}`)).toBe('ghp_********');
  });

  it('masks CSV cells by their column', () => {
    const lines = parseLog('{"user":"ann","password":"hunter2-Real!"}\n');
    const csv = toCsv(lines, ['user', 'password'], { mask: (value, column) => maskField(column, value) });
    expect(csv).toBe('user,password\r\nann,********\r\n');
  });
});

describe('bookmark report', () => {
  it('masks the body of a private key line by line', () => {
    const lines = parseLog('INFO key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAxyz\n-----END RSA PRIVATE KEY-----\n');
    const report = bookmarkReport([{ line: 3, note: '' }], lines, { title: 'x', url: '', timeMode: 'utc', mask: maskSecrets });
    expect(report).not.toContain('MIIEpAIBAAKCAQEAxyz');
    expect(report).toContain('****');
  });
});
