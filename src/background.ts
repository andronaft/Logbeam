import { TRANSFORMS } from './lib/transforms';
import { setAutoOpen, syncAutoOpenRegistrations } from './shared/autoOpen';
import { COMPARE_ADD, compareText } from './shared/compare';
import { completePending, forgetTab, setDarkMode, syncRegistrations, toggleDarkMode } from './shared/darkMode';
import { clearIconReport, openLogViewer, readTextForCompare, reportOnIcon, runTransformInTab } from './shared/inject';

const MENU_ROOT = 'logbeam';
const MENU_LOG_VIEWER = 'logbeam:log-viewer';
const MENU_DARK = 'logbeam:dark';
const MENU_COMPARE = 'logbeam:compare';
const TRANSFORM_PREFIX = 'logbeam:transform:';

function createMenus(): void {
  // promise form (missing from @types/chrome): Firefox builds use browser.*, which has no callbacks
  void (chrome.contextMenus.removeAll() as unknown as Promise<void>).then(() => {
    chrome.contextMenus.create({ id: MENU_ROOT, title: 'Logbeam', contexts: ['selection', 'editable', 'page'] });
    for (const transform of TRANSFORMS) {
      chrome.contextMenus.create({
        id: TRANSFORM_PREFIX + transform.id,
        parentId: MENU_ROOT,
        title: transform.title,
        contexts: ['selection', 'editable'],
      });
    }
    chrome.contextMenus.create({
      id: 'logbeam:sep',
      parentId: MENU_ROOT,
      type: 'separator',
      contexts: ['selection', 'editable'],
    });
    chrome.contextMenus.create({
      id: MENU_LOG_VIEWER,
      parentId: MENU_ROOT,
      title: 'Open page in log viewer',
      contexts: ['page', 'selection', 'editable'],
    });
    chrome.contextMenus.create({
      id: MENU_COMPARE,
      parentId: MENU_ROOT,
      title: 'Compare…',
      contexts: ['page', 'selection', 'editable'],
    });
    chrome.contextMenus.create({
      id: MENU_DARK,
      parentId: MENU_ROOT,
      title: 'Toggle dark mode for this site',
      contexts: ['page', 'selection', 'editable'],
    });
  });
}

function syncAll(): void {
  void syncRegistrations();
  void syncAutoOpenRegistrations();
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
  syncAll();
});

chrome.runtime.onStartup.addListener(syncAll);

chrome.permissions.onAdded.addListener(() => {
  void completePending((feature, tab) => (feature === 'dark' ? setDarkMode(tab, true, true) : setAutoOpen(tab.url, true)));
});

chrome.permissions.onRemoved.addListener(syncAll);

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
});

// A reload or navigation drops tab-only dark mode (the injected CSS is gone) and any error badge.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    void forgetTab(tabId);
    void clearIconReport(tabId);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const id = String(info.menuItemId);
  const tabId = tab.id;
  if (id === MENU_LOG_VIEWER) {
    void openLogViewer(tabId).then((result) => reportOnIcon(tabId, result));
  } else if (id === MENU_DARK) {
    void toggleDarkMode(tab).then((result) => reportOnIcon(tabId, result));
  } else if (id === MENU_COMPARE) {
    void readTextForCompare(tabId, info.frameId).then(async (text) => {
      if (text) await compareText(text, tab.title);
      else await reportOnIcon(tabId, { ok: false, reason: 'Logbeam couldn’t read text on this page to compare.' });
    });
  } else if (id.startsWith(TRANSFORM_PREFIX)) {
    void runTransformInTab(tabId, id.slice(TRANSFORM_PREFIX.length), info.frameId).then((result) => reportOnIcon(tabId, result));
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  const tabId = tab.id;
  if (command === 'open-log-viewer') {
    void openLogViewer(tabId).then((result) => reportOnIcon(tabId, result));
  } else if (command === 'toggle-dark-mode') {
    void toggleDarkMode(tab).then((result) => reportOnIcon(tabId, result));
  }
});

// the log viewer's Compare button (a content script can't open extension pages itself)
chrome.runtime.onMessage.addListener((message: { type?: string; text?: string; name?: string }, _sender, sendResponse) => {
  if (message?.type !== COMPARE_ADD || typeof message.text !== 'string') return;
  void compareText(message.text, message.name).then(sendResponse);
  return true; // answered asynchronously
});
