/**
 * Translations from _locales/<language>/messages.json, chosen by the browser's language. The
 * English text stays in the code as the fallback, so a missing translation shows English.
 */
export function t(key: string, fallback: string): string {
  try {
    return chrome.i18n.getMessage(key) || fallback;
  } catch {
    // no extension APIs (the viewer injected into a page by a test)
    return fallback;
  }
}

/** The message name for a text tool's label: tool_json_format_short. */
export function toolKey(id: string, part: 'short' | 'title'): string {
  return `tool_${id.replace(/-/g, '_')}_${part}`;
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
  const language = t('@@ui_locale', 'en').split('_')[0];
  document.documentElement.lang = language;
}
