/**
 * Light or dark for Logbeam's pages (the log viewer, Compare, Settings, the popup). "auto" follows
 * the system through prefers-color-scheme in each page's CSS; "dark" and "light" set
 * <html data-theme>, which the CSS checks first.
 */
export function applyTheme(theme: 'auto' | 'dark' | 'light'): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
