/**
 * Dark mode per site with the least privilege possible:
 * - "Remember for this site" asks for a host permission for that one origin and registers
 *   dark.css as a content script there, so it applies from document_start on every visit.
 * - Without that permission (or before it's granted) the CSS is injected into the current
 *   tab only, using the temporary activeTab grant.
 */

const STORAGE_KEY = 'darkSites';
const TEMP_KEY = 'darkTabs';
const PENDING_KEY = 'darkPending';
const CSS_FILE = 'dark.css';

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

export async function isDarkForTab(tab: chrome.tabs.Tab): Promise<boolean> {
  const pattern = originPattern(tab.url);
  if (pattern && (await rememberedSites()).includes(pattern)) return true;
  return tab.id !== undefined && (await tempTabs()).includes(tab.id);
}

async function applyToTab(tabId: number, on: boolean): Promise<void> {
  const target = { tabId, allFrames: true };
  try {
    if (on) await chrome.scripting.insertCSS({ target, files: [CSS_FILE] });
    else await chrome.scripting.removeCSS({ target, files: [CSS_FILE] });
  } catch {
    // restricted page (Chrome Web Store, chrome://): nothing we can do there
  }
}

export async function hasPermission(pattern: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [pattern] });
}

async function register(pattern: string): Promise<void> {
  const id = scriptId(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      { id, matches: [pattern], css: [CSS_FILE], runAt: 'document_start', allFrames: true, persistAcrossSessions: true },
    ]);
  }
}

async function unregister(pattern: string): Promise<void> {
  const id = scriptId(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  }
}

/**
 * Turns dark mode on or off for a tab. When turning on and the origin permission is granted,
 * the choice is remembered for the whole site; otherwise it lasts for this tab only.
 * Returns whether the setting was remembered.
 */
export async function setDarkMode(tab: chrome.tabs.Tab, on: boolean): Promise<{ remembered: boolean }> {
  if (tab.id === undefined) return { remembered: false };
  const pattern = originPattern(tab.url);
  const sites = await rememberedSites();

  if (!on) {
    await setTempTab(tab.id, false);
    if (pattern && sites.includes(pattern)) {
      await unregister(pattern);
      await setRememberedSites(sites.filter((s) => s !== pattern));
      // CSS from a registered content script can't be removed from an open page, only by reloading it
      await chrome.tabs.reload(tab.id);
    } else {
      await applyToTab(tab.id, false);
    }
    return { remembered: false };
  }

  await applyToTab(tab.id, true);
  if (pattern && (await hasPermission(pattern))) {
    await register(pattern);
    if (!sites.includes(pattern)) await setRememberedSites([...sites, pattern]);
    await setTempTab(tab.id, false);
    return { remembered: true };
  }
  await setTempTab(tab.id, true);
  return { remembered: false };
}

export async function toggleDarkMode(tab: chrome.tabs.Tab): Promise<boolean> {
  const on = !(await isDarkForTab(tab));
  await setDarkMode(tab, on);
  return on;
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
export async function markPending(tab: chrome.tabs.Tab): Promise<void> {
  const pattern = originPattern(tab.url);
  if (pattern && tab.id !== undefined) {
    await chrome.storage.session.set({ [PENDING_KEY]: { pattern, tabId: tab.id } });
  }
}

export async function completePending(): Promise<void> {
  const data = await chrome.storage.session.get(PENDING_KEY);
  const pending = data[PENDING_KEY] as { pattern: string; tabId: number } | undefined;
  if (!pending || !(await hasPermission(pending.pattern))) return;
  await chrome.storage.session.remove(PENDING_KEY);
  try {
    const tab = await chrome.tabs.get(pending.tabId);
    if (originPattern(tab.url) === pending.pattern) {
      await setDarkMode(tab, true);
    }
  } catch {
    // the tab was closed in the meantime
  }
}
