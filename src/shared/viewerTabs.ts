/**
 * Opens text that isn't on a web page (pasted into the popup) in the log viewer, on the extension's
 * own viewer.html. The text goes through chrome.storage.session, so it stays in memory only.
 */

const PREFIX = 'viewerText:';
const INDEX_KEY = 'viewerTexts';
/** Older texts are dropped: session storage is small (10 MB in Chrome) and a reload only needs the latest. */
const KEEP = 3;
/** Leaves room in session storage for everything else; bigger logs can be opened as a file. */
export const MAX_PASTED_BYTES = 5_000_000;

export async function openTextInViewer(text: string, name = 'Pasted log'): Promise<void> {
  const id = crypto.randomUUID();
  const data = await chrome.storage.session.get(INDEX_KEY);
  const ids = [...((data[INDEX_KEY] as string[] | undefined) ?? []), id];
  const dropped = ids.splice(0, Math.max(0, ids.length - KEEP));
  await chrome.storage.session.remove(dropped.map((old) => PREFIX + old));
  await chrome.storage.session.set({ [PREFIX + id]: { text, name }, [INDEX_KEY]: ids });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?id=${id}`) });
}

export async function readViewerText(id: string): Promise<{ text: string; name: string } | null> {
  const data = await chrome.storage.session.get(PREFIX + id);
  return (data[PREFIX + id] as { text: string; name: string } | undefined) ?? null;
}

export function openFileViewer(): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
}
