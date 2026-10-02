/** Which browser Logbeam runs in, for the few places where Chrome, Edge and Firefox differ. */

export const IS_FIREFOX = typeof location !== 'undefined' && location.protocol === 'moz-extension:';
export const IS_EDGE = !IS_FIREFOX && typeof navigator !== 'undefined' && navigator.userAgent.includes(' Edg/');

/** Where the user manages Logbeam's settings, written the way they'd type it. */
export const EXTENSIONS_PAGE = IS_FIREFOX ? 'about:addons' : IS_EDGE ? 'edge://extensions' : 'chrome://extensions';

/** Opens the browser's keyboard shortcut settings. */
export async function openShortcutSettings(): Promise<void> {
  if (IS_FIREFOX) {
    // extensions can't open about:addons themselves
    const commands = chrome.commands as unknown as { openShortcutSettings(): Promise<void> };
    await commands.openShortcutSettings();
    return;
  }
  await chrome.tabs.create({ url: `${EXTENSIONS_PAGE}/shortcuts` });
}
