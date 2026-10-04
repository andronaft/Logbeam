/**
 * The Compare page (diff.html) and how texts get into it: the popup opens it empty, while the
 * context menu and the log viewer's Compare button add a text to it, one side at a time.
 */

export const COMPARE_KEY = 'compareInputs';
export const COMPARE_UPDATED = 'logbeam:compare-updated';
/** Sent by the log viewer (a content script) to the background with the log's text. */
export const COMPARE_ADD = 'logbeam:compare-add';

export interface CompareInputs {
  left: string;
  right: string;
  leftName?: string;
  rightName?: string;
}

// chrome.storage.session lives in memory only: compared logs and configs never reach the disk
export async function loadCompareInputs(): Promise<CompareInputs> {
  const data = await chrome.storage.session.get(COMPARE_KEY);
  return { left: '', right: '', ...(data[COMPARE_KEY] as Partial<CompareInputs> | undefined) };
}

export async function saveCompareInputs(inputs: CompareInputs): Promise<void> {
  await chrome.storage.session.set({ [COMPARE_KEY]: inputs });
}

/**
 * Adds a text to the next free side: Before first, then After. When both are full, After moves to
 * Before, so the last two texts added are the ones compared. Returns the side it went to.
 */
export async function addToCompare(text: string, name?: string): Promise<'left' | 'right'> {
  const inputs = await loadCompareInputs();
  let side: 'left' | 'right';
  if (!inputs.left) {
    Object.assign(inputs, { left: text, leftName: name });
    side = 'left';
  } else if (!inputs.right) {
    Object.assign(inputs, { right: text, rightName: name });
    side = 'right';
  } else {
    Object.assign(inputs, { left: inputs.right, leftName: inputs.rightName, right: text, rightName: name });
    side = 'right';
  }
  await saveCompareInputs(inputs);
  return side;
}

const WAITING_TITLE = 'Logbeam: one text is ready to compare. Choose “Compare…” on the second one.';

/**
 * Adds a text and, once both sides are filled, shows the Compare page. After the first text the
 * toolbar icon shows "1" until the second one arrives.
 */
export async function compareText(text: string, name?: string): Promise<'left' | 'right'> {
  const side = await addToCompare(text, name);
  if (side === 'left') {
    await chrome.action.setBadgeBackgroundColor({ color: '#ffb454' });
    await chrome.action.setBadgeText({ text: '1' });
    await chrome.action.setTitle({ title: WAITING_TITLE });
  } else {
    await openCompare();
  }
  return side;
}

/** Shows the Compare page: brings an open one to the front (it reloads its inputs) or opens a new tab. */
export async function openCompare(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setTitle({ title: 'Logbeam' });
  const answered = await chrome.runtime.sendMessage({ type: COMPARE_UPDATED }).catch(() => false);
  if (!answered) await chrome.tabs.create({ url: chrome.runtime.getURL('diff.html') });
}
