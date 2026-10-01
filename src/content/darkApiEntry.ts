import { darkApi } from './darkPage';

// Injected on demand (popup, shortcut, context menu) before calling window.__logbeamDark.set().
darkApi();
