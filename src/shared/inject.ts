/** Injects Logbeam's page scripts on demand, using the activeTab grant from the click or shortcut. */

export type InjectResult = { ok: true } | { ok: false; reason: string };

/** Explains why Chrome won't let an extension run on a page, in words a user can act on. */
export async function whyNotAllowed(url: string | undefined, error?: unknown): Promise<string> {
  const u = url ?? '';
  if (
    /^(chrome|edge|brave|opera|about|chrome-extension|devtools|view-source):/.test(u) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(u)
  ) {
    return 'Chrome doesn’t let extensions run on its own pages and the Web Store.';
  }
  if (u.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    return 'To open local files, turn on “Allow access to file URLs” for Logbeam on chrome://extensions → Details.';
  }
  if (/\.pdf($|[?#])/i.test(u)) {
    return 'Chrome’s PDF viewer can’t be used by extensions.';
  }
  const message = error instanceof Error ? error.message : '';
  return message ? `Logbeam can’t run on this page: ${message}` : 'Logbeam can’t run on this page.';
}

async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await chrome.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

export async function openLogViewer(tabId: number): Promise<InjectResult> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['logViewer.js'] });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: await whyNotAllowed(await tabUrl(tabId), e) };
  }
}

export async function runTransformInTab(tabId: number, transformId: string, frameId?: number): Promise<InjectResult> {
  const target = frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId };
  try {
    await chrome.scripting.executeScript({ target, files: ['panel.js'] });
    await chrome.scripting.executeScript({
      target,
      func: (id: string) => {
        (window as unknown as { __logbeamPanel?: { run(id: string): void } }).__logbeamPanel?.run(id);
      },
      args: [transformId],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: await whyNotAllowed(await tabUrl(tabId), e) };
  }
}

/**
 * Shortcuts and the context menu have no UI of their own, so a failure is shown on the toolbar
 * icon: a red "!" badge with the reason as its tooltip, cleared when the tab navigates.
 */
export async function reportOnIcon(tabId: number, result: InjectResult | { state: unknown }): Promise<void> {
  const failed = 'ok' in result ? !result.ok : result.state === null;
  if (!failed) return;
  const reason = 'reason' in result ? result.reason : await whyNotAllowed(await tabUrl(tabId));
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ff6b6b' });
  await chrome.action.setBadgeText({ tabId, text: '!' });
  await chrome.action.setTitle({ tabId, title: `Logbeam: ${reason}` });
}

export async function clearIconReport(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  await chrome.action.setTitle({ tabId, title: 'Logbeam' }).catch(() => undefined);
}
