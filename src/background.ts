import { TRANSFORMS } from './lib/transforms';
import { completePending, forgetTab, syncRegistrations, toggleDarkMode } from './shared/darkMode';
import { openLogViewer, runTransformInTab } from './shared/inject';

const MENU_ROOT = 'logbeam';
const MENU_LOG_VIEWER = 'logbeam:log-viewer';
const MENU_DARK = 'logbeam:dark';
const TRANSFORM_PREFIX = 'logbeam:transform:';

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ROOT, title: 'Logbeam', contexts: ['selection', 'editable', 'page'] });
    for (const transform of TRANSFORMS) {
      chrome.contextMenus.create({
        id: TRANSFORM_PREFIX + transform.id,
        parentId: MENU_ROOT,
        title: transform.title,
        contexts: ['selection', 'editable'],
      });
    }
    chrome.contextMenus.create({ id: 'logbeam:sep', parentId: MENU_ROOT, type: 'separator', contexts: ['selection', 'editable'] });
    chrome.contextMenus.create({ id: MENU_LOG_VIEWER, parentId: MENU_ROOT, title: 'Open page in log viewer', contexts: ['page', 'selection', 'editable'] });
    chrome.contextMenus.create({ id: MENU_DARK, parentId: MENU_ROOT, title: 'Toggle dark mode for this site', contexts: ['page', 'selection', 'editable'] });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createMenus();
  void syncRegistrations();
});

chrome.runtime.onStartup.addListener(() => {
  void syncRegistrations();
});

chrome.permissions.onAdded.addListener(() => {
  void completePending();
});

chrome.permissions.onRemoved.addListener(() => {
  void syncRegistrations();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void forgetTab(tabId);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const id = String(info.menuItemId);
  if (id === MENU_LOG_VIEWER) {
    void openLogViewer(tab.id);
  } else if (id === MENU_DARK) {
    void toggleDarkMode(tab);
  } else if (id.startsWith(TRANSFORM_PREFIX)) {
    void runTransformInTab(tab.id, id.slice(TRANSFORM_PREFIX.length), info.frameId);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === 'open-log-viewer') {
    void openLogViewer(tab.id);
  } else if (command === 'toggle-dark-mode') {
    void toggleDarkMode(tab);
  }
});
