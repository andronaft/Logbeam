/**
 * Translations from _locales/<language>/messages.json, chosen by the browser's language. The
 * English text stays in the code as the fallback, so a missing translation shows English.
 * {name} in a message is replaced by values.name.
 */
export function t(key: string, fallback: string, values: Record<string, string | number> = {}): string {
  let message: string;
  try {
    message = chrome.i18n.getMessage(key) || fallback;
  } catch {
    // no extension APIs (the viewer injected into a page by a test, a worker)
    message = fallback;
  }
  return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

let pluralRules: Intl.PluralRules | undefined;

/**
 * A message with a count, in the plural form the language needs: key_one, key_few, key_many or
 * key_other (Ukrainian has all four, English only one and other). {n} is the formatted count.
 */
export function tn(key: string, n: number, one: string, other: string, values: Record<string, string | number> = {}): string {
  pluralRules ??= new Intl.PluralRules(t('@@ui_locale', 'en').replace('_', '-'));
  const form = pluralRules.select(n);
  return t(`${key}_${form}`, form === 'one' ? one : other, { n: n.toLocaleString(), ...values });
}

/** The message name for a text tool's label: tool_json_format_short. */
export function toolKey(id: string, part: 'short' | 'title'): string {
  return `tool_${id.replace(/-/g, '_')}_${part}`;
}

/** The browser's language for the lang attribute: uk, en. */
export function uiLanguage(): string {
  return t('@@ui_locale', 'en').split('_')[0];
}

/**
 * Translates a page's static text: data-i18n sets the text, data-i18n-placeholder and
 * data-i18n-title set those attributes. The English in the HTML is the fallback.
 */
export function localizePage(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n!, element.textContent ?? '');
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder!, element.getAttribute('placeholder') ?? ''));
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle!, element.title);
  }
  document.documentElement.lang = uiLanguage();
}
