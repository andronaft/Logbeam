/**
 * "Open logs automatically on this site": registers autoOpen.js as a content script for one
 * origin (after the user grants access to just that origin). The script only takes over
 * plain-text pages that look like logs, so normal pages on the site are left alone.
 */

import { hasPermission, originPattern } from './darkMode';

const STORAGE_KEY = 'autoLogSites';
const SCRIPT_FILE = 'autoOpen.js';

const scriptId = (pattern: string) => `auto:${pattern}`;

export async function autoOpenSites(): Promise<string[]> {
  const data = await chrome.storage.sync.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as string[] | undefined) ?? [];
}

async function setAutoOpenSites(sites: string[]): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: sites });
}

export async function isAutoOpen(url: string | undefined): Promise<boolean> {
  const pattern = originPattern(url);
  return pattern !== null && (await autoOpenSites()).includes(pattern);
}

async function register(pattern: string): Promise<void> {
  const id = scriptId(pattern);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      { id, matches: [pattern], js: [SCRIPT_FILE], runAt: 'document_idle', persistAcrossSessions: true },
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

/** Needs the origin permission to turn on; returns whether the setting is now on. */
export async function setAutoOpen(url: string | undefined, on: boolean): Promise<boolean> {
  const pattern = originPattern(url);
  if (!pattern) return false;
  const sites = await autoOpenSites();
  if (!on) {
    await unregister(pattern);
    await setAutoOpenSites(sites.filter((s) => s !== pattern));
    return false;
  }
  if (!(await hasPermission(pattern))) return false;
  await register(pattern);
  if (!sites.includes(pattern)) await setAutoOpenSites([...sites, pattern]);
  return true;
}

export async function syncAutoOpenRegistrations(): Promise<void> {
  const sites = await autoOpenSites();
  const kept: string[] = [];
  for (const pattern of sites) {
    if (await hasPermission(pattern)) {
      await register(pattern);
      kept.push(pattern);
    } else {
      await unregister(pattern);
    }
  }
  if (kept.length !== sites.length) await setAutoOpenSites(kept);
}
