/** User settings (the options page), kept with chrome.storage.sync like the per-site choices. */

export interface CustomSecret {
  name: string;
  pattern: string;
}

export interface Settings {
  /** Pauses between entries shorter than this aren't shown in the viewer. */
  gapThresholdMs: number;
  /** Extra secret patterns, e.g. an internal token format. */
  customSecrets: CustomSecret[];
  /** Text tools left out of the right-click menu. */
  hiddenTools: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  gapThresholdMs: 1000,
  customSecrets: [],
  hiddenTools: [],
};

export const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<Settings> | undefined) };
  } catch {
    // e.g. the viewer injected into a page by a test, without extension APIs
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}
