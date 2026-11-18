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

const toAlpha = (value: string | undefined) =>
  value === undefined ? 1 : value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);

/**
 * Relative luminance (0 = black, 1 = white) of a CSS colour, or null if it's transparent or not
 * one Logbeam reads. Browsers give computed colours as rgb(), but keep oklch(), lab() and
 * color(srgb …) as written (Tailwind 4 colours are oklch).
 */
export function luminance(color: string): number | null {
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(color);
  if (rgb) {
    if (toAlpha(rgb[4]) < 0.5) return null;
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((v) => linear(parseFloat(v) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/.exec(color);
  if (srgb) {
    if (toAlpha(srgb[4]) < 0.5) return null;
    const [r, g, b] = [srgb[1], srgb[2], srgb[3]].map((v) => linear(parseFloat(v)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // the lightness is enough to tell dark from light: OKLab's L is about the cube root of luminance
  const lab = /^(ok)?(?:lab|lch)\(\s*([\d.]+)(%?)[^/)]*(?:\/\s*([\d.]+%?))?\s*\)/.exec(color.trim());
  if (lab) {
    if (toAlpha(lab[4]) < 0.5) return null;
    const ok = lab[1] !== undefined;
    // oklch(0.145 0 0) or oklch(14.5% 0 0); lab(14 0 0) is 0-100
    const lightness = parseFloat(lab[2]) / (lab[3] || !ok ? 100 : 1);
    return ok ? lightness ** 3 : ((lightness * 100 + 16) / 116) ** 3;
  }
  return null;
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
