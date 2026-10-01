import type { DarkState } from '../content/darkPage';

/**
 * Dark mode per site with the least privilege possible:
 * - Turning it on applies to the current tab only, using the temporary activeTab grant.
 * - "Remember for this site" (and only that) asks for a host permission for that one origin and
 *   registers dark.css + darkAuto.js there, so it applies from document_start on every visit.
 * The page side (darkPage.ts) toggles a class, so turning it off needs no reload, and it leaves
 * pages alone that already have a dark theme.
 */

const STORAGE_KEY = 'darkSites';
const AUTO_OPEN_KEY = 'autoLogSites'; // see autoOpen.ts; both features share the site permission
const TEMP_KEY = 'darkTabs';
const PENDING_KEY = 'darkPending';
const CSS_FILE = 'dark.css';
const API_FILE = 'darkApi.js';
const AUTO_FILE = 'darkAuto.js';

/** "https://example.com/*" for http(s) pages, null for chrome://, file:// etc. */
export function originPattern(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return `${protocol}//${hostname}/*`;
  } catch {
    return null;
  }
}

export function scriptId(pattern: string): string {
  return `dark:${pattern}`;
}

export async function rememberedSites(): Promise<string[]> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as string[] | undefined) ?? [];
}

async function setRememberedSites(sites: string[]): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: sites });
}

async function tempTabs(): Promise<number[]> {
  const data = await chrome.storage.session.get(TEMP_KEY);
  return (data[TEMP_KEY] as number[] | undefined) ?? [];
}

async function setTempTab(tabId: number, on: boolean): Promise<void> {
  const tabs = new Set(await tempTabs());
  if (on) tabs.add(tabId);
  else tabs.delete(tabId);
  await chrome.storage.session.set({ [TEMP_KEY]: [...tabs] });
}

/** Asks the page whether the theme is on; null if Logbeam can't access the page right now. */
export async function pageDarkState(tabId: number): Promise<DarkState | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window as { __logbeamDark?: { state(): string } }).__logbeamDark?.state() ?? 'off',
    });
    return (result?.result as DarkState | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function isDarkForTab(tab: chrome.tabs.Tab): Promise<boolean> {
  if (tab.id !== undefined) {
    // the page knows best: tab-only dark mode doesn't survive a reload
    const state = await pageDarkState(tab.id);
    if (state !== null) return state === 'on';
  }
  const pattern = originPattern(tab.url);
  if (pattern && (await rememberedSites()).includes(pattern)) return true;
  return tab.id !== undefined && (await tempTabs()).includes(tab.id);
}

/** Applies or removes the theme in every frame of the tab; returns the top frame's state, or null if not allowed. */
async function applyToTab(tabId: number, on: boolean): Promise<DarkState | null> {
  const target = { tabId, allFrames: true };
  try {
    await chrome.scripting.executeScript({ target, files: [API_FILE] });
    if (on) await chrome.scripting.insertCSS({ target, files: [CSS_FILE] });
    const results = await chrome.scripting.executeScript({
      target,
      func: (value: boolean) => (window as { __logbeamDark?: { set(on: boolean): string } }).__logbeamDark?.set(value) ?? 'off',
      args: [on],
    });
    const top = results.find((r) => r.frameId === 0) ?? results[0];
    return (top?.result as DarkState | undefined) ?? null;
  } catch {
    // restricted page (Chrome Web Store, chrome://): nothing we can do there
    return null;
  }
}

/** Removes the host permission for a site once neither "Remember dark mode" nor "Open logs automatically" uses it. */
export async function releaseSiteIfUnused(pattern: string): Promise<void> {
  const data = await chrome.storage.sync.get([STORAGE_KEY, AUTO_OPEN_KEY]);
  const used = [...((data[STORAGE_KEY] as string[]) ?? []), ...((data[AUTO_OPEN_KEY] as string[]) ?? [])];
  if (!used.includes(pattern)) {
    await chrome.permissions.remove({ origins: [pattern] }).catch(() => undefined);
  }
}

export async function hasPermission(pattern: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [pattern] });
}

async function register(pattern: string): Promise<void> {
  const id = scriptId(pattern);
  const script = {
    id,
    matches: [pattern],
    css: [CSS_FILE],
    js: [AUTO_FILE],
    runAt: 'document_start' as const,
    allFrames: true,
    persistAcrossSessions: true,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  // update too: sites remembered by 0.2.0 were registered with the CSS only
  if (existing.length === 0) await chrome.scripting.registerContentScripts([script]);
  else await chrome.scripting.updateContentScripts([script]);
}

async function unregister(pattern: string): Promise<void> {
  const id = scriptId(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}

export interface DarkResult {
  /** What the page shows now; null if Logbeam can't run on it (chrome://, the Web Store…). */
  state: DarkState | null;
  remembered: boolean;
}

/**
 * Turns dark mode on or off for a tab. It is remembered for the site only when `remember` is
 * asked for (the popup's "Remember for this site"), even if the site permission already exists
 * for "Open logs automatically". Turning it off forgets the site and releases its permission.
 */
export async function setDarkMode(tab: chrome.tabs.Tab, on: boolean, remember = false): Promise<DarkResult> {
  if (tab.id === undefined) return { state: null, remembered: false };
  const pattern = originPattern(tab.url);
  const sites = await rememberedSites();

  if (!on) {
    await setTempTab(tab.id, false);
    const state = await applyToTab(tab.id, false);
    if (pattern && sites.includes(pattern)) {
      await unregister(pattern);
      await setRememberedSites(sites.filter((s) => s !== pattern));
      await releaseSiteIfUnused(pattern);
    }
    return { state, remembered: false };
  }

  const state = await applyToTab(tab.id, true);
  if (remember && pattern && (await hasPermission(pattern))) {
    await register(pattern);
    if (!sites.includes(pattern)) await setRememberedSites([...sites, pattern]);
    await setTempTab(tab.id, false);
    return { state, remembered: true };
  }
  await setTempTab(tab.id, state === 'on');
  return { state, remembered: pattern !== null && sites.includes(pattern) };
}

export async function toggleDarkMode(tab: chrome.tabs.Tab): Promise<DarkResult> {
  return setDarkMode(tab, !(await isDarkForTab(tab)));
}

/** Re-registers content scripts for remembered sites, e.g. after an update or a revoked permission. */
export async function syncRegistrations(): Promise<void> {
  const sites = await rememberedSites();
  const kept: string[] = [];
  for (const pattern of sites) {
    if (await hasPermission(pattern)) {
      await register(pattern);
      kept.push(pattern);
    } else {
      await unregister(pattern);
    }
  }
  if (kept.length !== sites.length) await setRememberedSites(kept);
}

export async function forgetTab(tabId: number): Promise<void> {
  await setTempTab(tabId, false);
}

/**
 * The popup can close while Chrome shows the permission prompt, which would drop whatever it
 * meant to do next. So it records the request first and the background finishes it when the
 * permission arrives.
 */
export type SiteFeature = 'dark' | 'auto-open';

export async function markPending(tab: chrome.tabs.Tab, feature: SiteFeature): Promise<void> {
  const pattern = originPattern(tab.url);
  if (pattern && tab.id !== undefined) {
    await chrome.storage.session.set({ [PENDING_KEY]: { pattern, tabId: tab.id, feature } });
  }
}

/** Finishes a request started in the popup, once the permission has been granted. */
export async function completePending(apply: (feature: SiteFeature, tab: chrome.tabs.Tab) => Promise<unknown>): Promise<void> {
  const data = await chrome.storage.session.get(PENDING_KEY);
  const pending = data[PENDING_KEY] as { pattern: string; tabId: number; feature: SiteFeature } | undefined;
  if (!pending || !(await hasPermission(pending.pattern))) return;
  await chrome.storage.session.remove(PENDING_KEY);
  try {
    const tab = await chrome.tabs.get(pending.tabId);
    if (originPattern(tab.url) === pending.pattern) {
      await apply(pending.feature, tab);
    }
  } catch {
    // the tab was closed in the meantime
  }
}
