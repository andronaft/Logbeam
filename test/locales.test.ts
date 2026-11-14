import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Messages = Record<string, { message: string }>;

const read = (locale: string): Messages => JSON.parse(readFileSync(`_locales/${locale}/messages.json`, 'utf8')) as Messages;
const english = read('en');
const translations = readdirSync('_locales').filter((locale) => locale !== 'en');

/** viewerLinesCopied_few → viewerLinesCopied: a language may need more plural forms than English has. */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const placeholders = (message: string) => [...new Set(message.match(/\{\w+\}/g) ?? [])].sort();

const englishBases = new Set(Object.keys(english).map(base));
/** The {placeholders} the code fills in for a message, from any of its English forms. */
const allowed = new Map<string, Set<string>>();
for (const [key, { message }] of Object.entries(english)) {
  const known = allowed.get(base(key)) ?? new Set<string>();
  for (const name of placeholders(message)) known.add(name);
  allowed.set(base(key), known);
}

describe.each(translations)('_locales/%s', (locale) => {
  const messages = read(locale);

  it('has no message that English lacks', () => {
    expect(Object.keys(messages).filter((key) => !englishBases.has(base(key)))).toEqual([]);
  });

  it('translates every message', () => {
    const translated = new Set(Object.keys(messages).map(base));
    expect([...englishBases].filter((key) => !translated.has(key))).toEqual([]);
  });

  it('has an "other" form for every plural', () => {
    const plurals = new Set(
      Object.keys(messages)
        .filter((key) => PLURAL.test(key))
        .map(base),
    );
    expect([...plurals].filter((key) => !(`${key}_other` in messages))).toEqual([]);
  });

  it('uses only the {placeholders} the code fills in', () => {
    const wrong = Object.entries(messages)
      .filter(([key, { message }]) => placeholders(message).some((name) => !allowed.get(base(key))?.has(name)))
      .map(([key]) => key);
    expect(wrong).toEqual([]);
  });

  it('has no empty message', () => {
    expect(Object.keys(messages).filter((key) => !messages[key].message.trim())).toEqual([]);
  });
});
