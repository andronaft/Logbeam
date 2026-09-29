import { openViewer } from './logViewer';

declare global {
  interface Window {
    __logbeamViewer?: boolean;
  }
}

// injected on demand (toolbar, shortcut, context menu); running it twice must not rebuild the page
if (!window.__logbeamViewer) {
  window.__logbeamViewer = true;
  void openViewer();
}
