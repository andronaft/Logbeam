import { t } from '../shared/i18n';

/** The log viewer's keys, listed by the ? overlay. */
const SHORTCUTS: { keys: string[]; message: string; text: string }[] = [
  { keys: ['/'], message: 'keySearch', text: 'Search' },
  { keys: ['Enter'], message: 'keyPin', text: 'Pin the search as a highlight (in the search box)' },
  { keys: ['j', 'k'], message: 'keyNextPrevLine', text: 'Next / previous line' },
  { keys: ['g', 'G'], message: 'keyFirstLastLine', text: 'First / last line' },
  { keys: ['Shift+click'], message: 'keySelectRange', text: 'Select the lines from the selected one to the clicked one' },
  { keys: ['J', 'K'], message: 'keyExtendSelection', text: 'Add the next line to the selection / take it back' },
  { keys: ['y'], message: 'keyCopyViewLink', text: 'Copy a link to this view, with its filters and selected lines' },
  { keys: ['e'], message: 'keyNextError', text: 'Next error' },
  { keys: ['s'], message: 'keyNextSecret', text: 'Next leaked secret' },
  { keys: ['m'], message: 'keyBookmark', text: 'Bookmark the selected line' },
  { keys: ['b'], message: 'keyNextBookmark', text: 'Next bookmark' },
  { keys: ['Esc'], message: 'keyEscape', text: 'Clear the search, or close the line details' },
  { keys: ['?'], message: 'keyHelp', text: 'Show or hide these keys' },
];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]) {
  const element = document.createElement(tag);
  element.className = className;
  element.append(...children);
  return element;
}

/**
 * The overlay that lists the keys. Built from DOM nodes, not innerHTML, so it works on pages
 * with Trusted Types. A click outside the box closes it.
 */
export function shortcutsHelp(): HTMLElement {
  const rows = SHORTCUTS.map(({ keys, message, text }) =>
    node('div', 'help-row', node('span', 'help-keys', ...keys.map((key) => node('kbd', '', key))), t(message, text)),
  );
  const box = node('div', 'help-box', node('h2', '', t('keysTitle', 'Keyboard shortcuts')), ...rows);
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', t('keysTitle', 'Keyboard shortcuts'));
  const overlay = node('div', 'help', box);
  overlay.hidden = true;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.hidden = true;
  });
  return overlay;
}
