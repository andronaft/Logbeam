/**
 * Page side of dark mode: adds or removes the `logbeam-dark` class that dark.css is scoped to,
 * and leaves pages alone that already have a dark theme (inverting those would make them light).
 */

export const DARK_CLASS = 'logbeam-dark';

export type DarkState = 'on' | 'off' | 'native-dark';

export interface DarkApi {
  set(on: boolean): DarkState;
  state(): DarkState;
}

declare global {
  interface Window {
    __logbeamDark?: DarkApi;
  }
}

/** Relative luminance (0 = black, 1 = white) of a CSS colour, or null if it's transparent. */
export function luminance(color: string): number | null {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(color);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha < 0.5) return null;
  const channel = (v: string) => {
    const c = parseFloat(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

/**
 * The page's own background, read from computed styles (filters don't change them). A page with
 * no background at all is white, so it isn't dark.
 */
export function pageIsAlreadyDark(): boolean {
  // dark.css paints <html> white (so transparent pages invert to dark); read the page's own colours
  const root = document.documentElement;
  const had = root.classList.contains(DARK_CLASS);
  if (had) root.classList.remove(DARK_CLASS);
  try {
    return ownBackgroundIsDark();
  } finally {
    if (had) root.classList.add(DARK_CLASS);
  }
}

function ownBackgroundIsDark(): boolean {
  for (const element of [document.body, document.documentElement]) {
    if (!element) continue;
    const value = luminance(getComputedStyle(element).backgroundColor);
    if (value !== null) return value < 0.2;
  }
  return false;
}

function install(): DarkApi {
  const root = document.documentElement;
  let nativeDark = false;
  const api: DarkApi = {
    set(on) {
      if (!on) {
        root.classList.remove(DARK_CLASS);
        return 'off';
      }
      // the body may not exist yet at document_start; it's checked again once the DOM is ready
      nativeDark = document.body !== null && pageIsAlreadyDark();
      root.classList.toggle(DARK_CLASS, !nativeDark);
      return nativeDark ? 'native-dark' : 'on';
    },
    state() {
      if (root.classList.contains(DARK_CLASS)) return 'on';
      return nativeDark ? 'native-dark' : 'off';
    },
  };
  return api;
}

export function darkApi(): DarkApi {
  window.__logbeamDark ??= install();
  return window.__logbeamDark;
}

/** For sites with "Remember dark mode": apply at document_start, re-check once the page has its styles. */
export function applyRemembered(): void {
  const api = darkApi();
  api.set(true);
  const recheck = () => {
    if (api.state() === 'on' && pageIsAlreadyDark()) api.set(true);
  };
  document.addEventListener('DOMContentLoaded', recheck, { once: true });
  window.addEventListener('load', recheck, { once: true });
}
