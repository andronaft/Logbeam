/**
 * Bookmarks of a log, kept while the browser is open (in memory, not on disk). A content script
 * can't use storage.session itself, so the viewer asks the background page to keep them.
 */
export const BOOKMARKS_GET = 'logbeam:bookmarks-get';
export const BOOKMARKS_SET = 'logbeam:bookmarks-set';
/** Only keys like this can be read or written through these messages. */
export const BOOKMARKS_PREFIX = 'bookmarks:';

export type SavedBookmarks = [number, string][];

export async function loadBookmarks(key: string): Promise<SavedBookmarks> {
  const saved: unknown = await chrome.runtime.sendMessage({ type: BOOKMARKS_GET, key });
  return Array.isArray(saved) ? (saved as SavedBookmarks) : [];
}

export async function saveBookmarks(key: string, bookmarks: SavedBookmarks): Promise<void> {
  await chrome.runtime.sendMessage({ type: BOOKMARKS_SET, key, bookmarks });
}

/** In the background page: answers the viewer's messages. */
export function handleBookmarkMessage(
  message: { type?: string; key?: unknown; bookmarks?: unknown },
  sendResponse: (response: unknown) => void,
): boolean {
  if (typeof message.key !== 'string' || !message.key.startsWith(BOOKMARKS_PREFIX)) return false;
  const key = message.key;
  if (message.type === BOOKMARKS_GET) {
    chrome.storage.session
      .get(key)
      .then((data) => sendResponse(data[key] ?? null))
      .catch(() => sendResponse(null));
    return true;
  }
  if (message.type === BOOKMARKS_SET && Array.isArray(message.bookmarks)) {
    const done = () => sendResponse(null);
    (message.bookmarks.length
      ? chrome.storage.session.set({ [key]: message.bookmarks })
      : chrome.storage.session.remove(key)
    ).then(done, done);
    return true;
  }
  return false;
}
