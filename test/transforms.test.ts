import { describe, expect, it } from 'vitest';
import {
  TRANSFORMS,
  base64Decode,
  base64Encode,
  convertTimestamp,
  decodeJwt,
  describeJwt,
  formatJson,
  minifyJson,
  sortLines,
  toCamelCase,
  toConstantCase,
  toKebabCase,
  toSnakeCase,
  uniqueLines,
  urlDecode,
  urlEncode,
  words,
} from '../src/lib/transforms';

// {"alg":"HS256","typ":"JWT"} . {"sub":"anna","roles":["ROLE_USER"],"iat":1700000000,"exp":1700003600} . signature
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJhbm5hIiwicm9sZXMiOlsiUk9MRV9VU0VSIl0sImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAzNjAwfQ.' +
  'c2lnbmF0dXJl';

describe('JSON', () => {
  it('formats and minifies', () => {
    expect(formatJson('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(minifyJson('{\n  "a": 1\n}')).toBe('{"a":1}');
  });

  it('explains invalid input', () => {
    expect(() => formatJson('{a:1}')).toThrow(/Not valid JSON/);
  });
});

describe('Base64 and URL encoding', () => {
  it('round-trips UTF-8, including Cyrillic and emoji', () => {
    const text = 'Привіт, Logbeam 🔦';
    expect(base64Decode(base64Encode(text))).toBe(text);
    expect(base64Encode('hello')).toBe('aGVsbG8=');
  });

  it('decodes URL-safe Base64 without padding', () => {
    expect(base64Decode('aGVsbG8')).toBe('hello');
    expect(base64Decode('-_8')).toBe(base64Decode('+/8='));
  });

  it('rejects garbage', () => {
    expect(() => base64Decode('not base64!')).toThrow(/Base64/);
  });

  it('URL-encodes and decodes', () => {
    expect(urlEncode('a b&c=д')).toBe('a%20b%26c%3D%D0%B4');
    expect(urlDecode('a+b%26c')).toBe('a b&c');
    expect(() => urlDecode('%E0%A4%A')).toThrow();
  });
});

describe('JWT', () => {
  it('decodes header and payload, also with a Bearer prefix', () => {
    const decoded = decodeJwt(`Bearer_${JWT}`);
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.payload.sub).toBe('anna');
    expect(decoded.signaturePresent).toBe(true);
  });

  it('shows claim dates and whether the token has expired', () => {
    const beforeExpiry = describeJwt(JWT, 1700000000_000 + 60_000);
    expect(beforeExpiry).toContain('exp: 2023-11-14T23:13:20.000Z');
    expect(beforeExpiry).toContain('valid for another 59m 0s');
    expect(describeJwt(JWT, 1700003600_000 + 3 * 3600_000)).toContain('EXPIRED 3h 0m ago');
  });

  it('rejects things that are not JWTs', () => {
    expect(() => decodeJwt('abc')).toThrow(/three dot-separated parts/);
    expect(() => decodeJwt('a.b.c')).toThrow(/header/);
  });
});

describe('timestamps', () => {
  it('converts seconds and millis to dates', () => {
    expect(convertTimestamp('1700000000')).toContain('UTC:   2023-11-14T22:13:20.000Z');
    expect(convertTimestamp('1700000000000')).toContain('UTC:   2023-11-14T22:13:20.000Z');
  });

  it('converts dates to Unix time', () => {
    expect(convertTimestamp('2023-11-14T22:13:20Z')).toContain('seconds: 1700000000');
  });

  it('rejects other input', () => {
    expect(() => convertTimestamp('yesterday-ish')).toThrow();
  });
});

describe('case conversion', () => {
  it('splits words from any style', () => {
    expect(words('parseHTTPResponse_code-now')).toEqual(['parse', 'http', 'response', 'code', 'now']);
  });

  it('converts between styles', () => {
    expect(toCamelCase('user_profile_id')).toBe('userProfileId');
    expect(toSnakeCase('userProfileId')).toBe('user_profile_id');
    expect(toKebabCase('User Profile ID')).toBe('user-profile-id');
    expect(toConstantCase('jwt.token.secret')).toBe('JWT_TOKEN_SECRET');
  });
});

describe('lines', () => {
  it('sorts and de-duplicates', () => {
    expect(sortLines('b\na\nc')).toBe('a\nb\nc');
    expect(uniqueLines('a\nb\na\nc\nb')).toBe('a\nb\nc');
  });
});

describe('mask secrets', () => {
  it('masks and explains when there is nothing to mask', () => {
    expect(TRANSFORMS.find((t) => t.id === 'mask-secrets')!.apply('password=hunter2hunter2')).toBe('password=hunt**********');
    expect(() => TRANSFORMS.find((t) => t.id === 'mask-secrets')!.apply('hello')).toThrow(/No secrets/);
  });
});

describe('registry', () => {
  it('has unique ids', () => {
    const ids = TRANSFORMS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
