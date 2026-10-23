/** User settings (the options page), kept with chrome.storage.sync like the per-site choices. */
import type { CustomLevel } from '../lib/logs';

export interface CustomSecret {
  name: string;
  pattern: string;
}

/** How the log viewer was left: kept for the next log. */
export interface ViewPrefs {
  collapse: boolean;
  showGaps: boolean;
  showTimeline: boolean;
  maskSecrets: boolean;
  /** Lines of context around search matches. */
  context: number;
}

export interface Settings {
  /** Pauses between entries shorter than this aren't shown in the viewer. */
  gapThresholdMs: number;
  /** Extra secret patterns, e.g. an internal token format. */
  customSecrets: CustomSecret[];
  /** Text tools left out of the right-click menu. */
  hiddenTools: string[];
  /** Times in the viewer: as UTC, or in the browser's time zone. */
  timeMode: 'utc' | 'local';
  /** Level words of your own, e.g. ALERT → ERROR. */
  customLevels: CustomLevel[];
  /** Colours of Logbeam's pages: follow the system, or always dark or light. */
  theme: 'auto' | 'dark' | 'light';
  view: ViewPrefs;
}

export const DEFAULT_SETTINGS: Settings = {
  gapThresholdMs: 1000,
  customSecrets: [],
  hiddenTools: [],
  timeMode: 'utc',
  customLevels: [],
  theme: 'auto',
  view: { collapse: false, showGaps: true, showTimeline: true, maskSecrets: false, context: 0 },
};

export const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    const stored = data[SETTINGS_KEY] as Partial<Settings> | undefined;
    // view grows new options over time: settings saved before one existed get its default
    return { ...DEFAULT_SETTINGS, ...stored, view: { ...DEFAULT_SETTINGS.view, ...stored?.view } };
  } catch {
    // e.g. the viewer injected into a page by a test, without extension APIs
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ [SETTINGS_KEY]: settings });
}
