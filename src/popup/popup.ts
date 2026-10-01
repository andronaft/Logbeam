import { TRANSFORMS } from '../lib/transforms';
import { isAutoOpen, setAutoOpen } from '../shared/autoOpen';
import {
  DarkResult,
  isDarkForTab,
  markPending,
  originPattern,
  releaseSiteIfUnused,
  rememberedSites,
  setDarkMode,
} from '../shared/darkMode';
import { openLogViewer, whyNotAllowed } from '../shared/inject';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// chrome.storage.session lives in memory only: pasted tokens never reach the disk and are gone
// when the browser closes
const INPUT_KEY = 'popupInput';

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function setupSite(): Promise<void> {
  const tab = await currentTab();
  const darkToggle = $<HTMLInputElement>('dark-toggle');
  const remember = $<HTMLInputElement>('dark-remember');
  const hint = $('dark-hint');
  const note = $('site-note');
  const openViewer = $<HTMLButtonElement>('open-viewer');
  const autoOpen = $<HTMLInputElement>('auto-open');

  const pattern = originPattern(tab?.url);
  if (!tab?.id || !pattern) {
    darkToggle.disabled = true;
    remember.disabled = true;
    autoOpen.disabled = true;
    note.hidden = false;
    note.textContent = 'Dark mode works on http(s) pages. The log viewer also works on plain-text files.';
  } else {
    $('site-name').textContent = new URL(tab.url!).hostname;
  }
  if (!tab?.id) {
    openViewer.disabled = true;
    return;
  }

  const showNote = (text: string) => {
    note.hidden = false;
    note.textContent = text;
  };
  const explainDark = async (result: DarkResult) => {
    if (result.state === 'native-dark') {
      showNote('This page already has a dark theme, so Logbeam leaves it as it is.');
    } else if (result.state === null) {
      showNote(await whyNotAllowed(tab.url));
    }
  };

  const refresh = async () => {
    darkToggle.checked = await isDarkForTab(tab);
    remember.checked = pattern !== null && (await rememberedSites()).includes(pattern);
    autoOpen.checked = await isAutoOpen(tab.url);
    hint.textContent = remember.checked ? 'Remembered for this site' : 'Applies to this tab';
  };
  await refresh();

  darkToggle.addEventListener('change', async () => {
    await explainDark(await setDarkMode(tab, darkToggle.checked));
    await refresh();
  });

  /**
   * Both per-site features share one host permission. It is requested straight from the click
   * (a user gesture, so before any await) and resolves at once if already granted; it is
   * removed only when neither feature needs it any more.
   */
  const requestSite = (feature: 'dark' | 'auto-open') => {
    const request = chrome.permissions.request({ origins: [pattern!] });
    void markPending(tab, feature);
    return request;
  };

  remember.addEventListener('change', async () => {
    if (!pattern) return;
    if (remember.checked) {
      if (await requestSite('dark')) await explainDark(await setDarkMode(tab, true, true));
    } else {
      await setDarkMode(tab, false); // forgets the site and releases its permission if unused
    }
    await refresh();
  });

  autoOpen.addEventListener('change', async () => {
    if (!pattern) return;
    if (autoOpen.checked) {
      if (await requestSite('auto-open')) await setAutoOpen(tab.url, true);
    } else {
      await setAutoOpen(tab.url, false);
      await releaseSiteIfUnused(pattern);
    }
    await refresh();
  });

  openViewer.addEventListener('click', async () => {
    const result = await openLogViewer(tab.id!);
    if (result.ok) window.close();
    else showNote(result.reason); // stay open so the reason can be read
  });
}

/** Shows the shortcuts actually assigned; Chrome leaves one empty when it clashes with another. */
async function setupShortcuts(): Promise<void> {
  const commands = await chrome.commands.getAll();
  const shortcut = (name: string) => commands.find((c) => c.name === name)?.shortcut ?? '';
  const openShortcuts = (event: Event) => {
    event.preventDefault();
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  };
  for (const [id, name] of [
    ['viewer-shortcut', 'open-log-viewer'],
    ['dark-shortcut', 'toggle-dark-mode'],
  ] as const) {
    const element = $(id);
    const keys = shortcut(name);
    element.textContent = keys || 'set shortcut';
    element.title = keys ? 'Change on chrome://extensions/shortcuts' : 'No shortcut assigned. Click to set one.';
    element.addEventListener('click', openShortcuts);
  }
}

function setupTools(): void {
  const input = $<HTMLTextAreaElement>('input');
  const output = $<HTMLPreElement>('output');
  const actions = $('output-actions');
  const grid = $('transforms');
  const copy = $<HTMLButtonElement>('copy');

  void chrome.storage.session.get(INPUT_KEY).then((data) => {
    if (!input.value) input.value = (data[INPUT_KEY] as string | undefined) ?? '';
  });
  input.addEventListener('input', () => {
    void chrome.storage.session.set({ [INPUT_KEY]: input.value });
  });

  for (const transform of TRANSFORMS) {
    const button = document.createElement('button');
    button.textContent = transform.short;
    button.title = transform.title;
    button.addEventListener('click', () => {
      output.hidden = false;
      try {
        output.textContent = transform.apply(input.value);
        output.classList.remove('error');
        actions.hidden = false;
      } catch (e) {
        output.textContent = (e as Error).message;
        output.classList.add('error');
        actions.hidden = true;
      }
      copy.textContent = 'Copy';
    });
    grid.append(button);
  }

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.textContent ?? '');
      copy.textContent = 'Copied ✓';
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  $('use-output').addEventListener('click', () => {
    input.value = output.textContent ?? '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
}

setupTools();
void setupSite();
void setupShortcuts();
