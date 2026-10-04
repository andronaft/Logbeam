/** Injects Logbeam's page scripts on demand, using the activeTab grant from the click or shortcut. */

import { EXTENSIONS_PAGE, IS_FIREFOX } from './browser';
import { t } from './i18n';

export type InjectResult = { ok: true } | { ok: false; reason: string };

/** Explains why the browser won't let an extension run on a page, in words a user can act on. */
export async function whyNotAllowed(url: string | undefined, error?: unknown): Promise<string> {
  const u = url ?? '';
  if (
    /^(chrome|edge|brave|opera|about|chrome-extension|moz-extension|resource|devtools|view-source):/.test(u) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons|addons\.mozilla\.org|addons\.opera\.com)/.test(
      u,
    )
  ) {
    return t('notAllowedBrowserPages', 'The browser doesn’t let extensions run on its own pages and add-on stores.');
  }
  // Firefox has no such switch: activeTab already covers local files there
  if (u.startsWith('file:') && !IS_FIREFOX && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    return t(
      'notAllowedFiles',
      'To open local files, turn on “Allow access to file URLs” for Logbeam on {page} → Details.',
    ).replace('{page}', EXTENSIONS_PAGE);
  }
  if (/\.pdf($|[?#])/i.test(u)) {
    return t('notAllowedPdf', 'The browser’s PDF viewer can’t be used by extensions.');
  }
  const message = error instanceof Error ? error.message : '';
  const reason = t('notAllowedGeneric', 'Logbeam can’t run on this page.');
  return message ? `${reason.replace(/\.$/, '')}: ${message}` : reason;
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
  // null drops the tab's own badge, so the global one ("1" while a compare waits) shows again
  await chrome.action.setBadgeText({ tabId, text: null as unknown as string }).catch(() => undefined);
  await chrome.action.setTitle({ tabId, title: 'Logbeam' }).catch(() => undefined);
}

/**
 * What "Compare…" in the context menu compares: the selection (in a text field or the page), or
 * else the whole page, using the original log when the viewer has replaced the page.
 */
export async function readTextForCompare(tabId: number, frameId?: number): Promise<string | null> {
  const target = frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId };
  try {
    const [result] = await chrome.scripting.executeScript({
      target,
      func: () => {
        const active = document.activeElement;
        if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
          const selected = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0);
          if (selected) return selected;
        }
        const selection = getSelection()?.toString();
        if (selection) return selection;
        const viewer = (window as unknown as { __logbeamLogText?: string }).__logbeamLogText;
        return viewer ?? document.body?.innerText ?? '';
      },
    });
    return typeof result?.result === 'string' ? result.result : null;
  } catch {
    return null;
  }
}
