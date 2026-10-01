import { describe, expect, it } from 'vitest';
import { findRegexRisk } from '../src/lib/regexSafety';

describe('findRegexRisk', () => {
  it('flags nested quantifiers', () => {
    for (const pattern of ['(a+)+$', '(a*)*', '(\\w+\\s?)*$', '((ab)+)+', '(x+){2,}', '(?:a+)+', '(a+)+?']) {
      expect(findRegexRisk(pattern), pattern).not.toBeNull();
    }
  });

  it('allows ordinary patterns', () => {
    for (const pattern of [
      'error|warn',
      'id=\\d+',
      '(foo|bar)+',
      '(ab)+c',
      'user(name)?=\\w+',
      '[(a+)+]',
      '\\(a+\\)+',
      'a{2}',
      'Connection|refused',
    ]) {
      expect(findRegexRisk(pattern), pattern).toBeNull();
    }
  });
});
