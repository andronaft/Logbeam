/**
 * Where a worker's code is loaded from. On web pages a content script can only start a worker
 * from a Blob (the extension's files are another origin); on the extension's own pages (the
 * viewer for pasted text and files) its CSP blocks blob: workers, but its own files load fine.
 */
export function workerUrl(code: string, file: string): string {
  if (/^(chrome|moz)-extension:$/.test(location.protocol)) return chrome.runtime.getURL(file);
  return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}
