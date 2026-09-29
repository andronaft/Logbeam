import { TRANSFORMS } from '../lib/transforms';
import { autoOpenSites, isAutoOpen, setAutoOpen } from '../shared/autoOpen';
import { isDarkForTab, markPending, originPattern, rememberedSites, setDarkMode } from '../shared/darkMode';
import { openLogViewer } from '../shared/inject';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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

  const refresh = async () => {
    darkToggle.checked = await isDarkForTab(tab);
    remember.checked = pattern !== null && (await rememberedSites()).includes(pattern);
    autoOpen.checked = await isAutoOpen(tab.url);
    hint.textContent = remember.checked ? 'Remembered for this site' : 'Applies to this tab';
  };
  await refresh();

  darkToggle.addEventListener('change', async () => {
    await setDarkMode(tab, darkToggle.checked);
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
  const releaseSiteIfUnused = async () => {
    const stillUsed = (await rememberedSites()).includes(pattern!) || (await autoOpenSites()).includes(pattern!);
    if (!stillUsed) await chrome.permissions.remove({ origins: [pattern!] }).catch(() => undefined);
  };

  remember.addEventListener('change', async () => {
    if (!pattern) return;
    if (remember.checked) {
      if (await requestSite('dark')) await setDarkMode(tab, true);
    } else {
      await setDarkMode(tab, false);
      await releaseSiteIfUnused();
    }
    await refresh();
  });

  autoOpen.addEventListener('change', async () => {
    if (!pattern) return;
    if (autoOpen.checked) {
      if (await requestSite('auto-open')) await setAutoOpen(tab.url, true);
    } else {
      await setAutoOpen(tab.url, false);
      await releaseSiteIfUnused();
    }
    await refresh();
  });

  openViewer.addEventListener('click', async () => {
    await openLogViewer(tab.id!);
    window.close();
  });
}

function setupTools(): void {
  const input = $<HTMLTextAreaElement>('input');
  const output = $<HTMLPreElement>('output');
  const actions = $('output-actions');
  const grid = $('transforms');
  const copy = $<HTMLButtonElement>('copy');

  try {
    input.value = localStorage.getItem(INPUT_KEY) ?? '';
  } catch {
    // storage can be unavailable; the popup still works
  }
  input.addEventListener('input', () => {
    try {
      localStorage.setItem(INPUT_KEY, input.value);
    } catch {
      // ignore
    }
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
    await navigator.clipboard.writeText(output.textContent ?? '');
    copy.textContent = 'Copied ✓';
  });
  $('use-output').addEventListener('click', () => {
    input.value = output.textContent ?? '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
}

setupTools();
void setupSite();
