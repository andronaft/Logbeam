/** Injects Logbeam's page scripts on demand, using the activeTab grant from the click or shortcut. */

export async function openLogViewer(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['logViewer.js'] });
  } catch (e) {
    console.warn('Logbeam: cannot open the log viewer on this page', e);
  }
}

export async function runTransformInTab(tabId: number, transformId: string, frameId?: number): Promise<void> {
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
  } catch (e) {
    console.warn('Logbeam: cannot run a tool on this page', e);
  }
}
