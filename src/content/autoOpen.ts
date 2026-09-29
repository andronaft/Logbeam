import { looksLikeLog } from '../lib/logs';
import { openViewer, readPageText } from './logViewer';

/**
 * Registered only for sites where the user turned on "Open logs automatically".
 * Takes over plain-text pages that look like logs; every other page is left untouched.
 */
declare global {
  interface Window {
    __logbeamViewer?: boolean;
  }
}

if (!window.__logbeamViewer && document.contentType === 'text/plain') {
  const text = readPageText();
  if (looksLikeLog(text)) {
    window.__logbeamViewer = true;
    void openViewer(text);
  }
}
