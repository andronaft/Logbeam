# Changelog

## 0.2.1

Fixes from two rounds of testing in Chromium.

### Fixed

- **A slow regex could freeze the tab.** Patterns with nested quantifiers like `(a+)+$` are refused at once,
  and every regex search now runs in a worker that is stopped after 2 seconds.
- **Mask left private keys readable.** The whole base64 body of a PEM key is now flagged and masked, not
  just its `BEGIN` line.
- **Missed secrets:** `SECRET_KEY=`, `access_token`, `refresh_token`, `token=`, `private_key`,
  `Authorization: Basic`, quoted passwords with spaces, and URL passwords that contain `@`.
- **Masking revealed part of the value.** Secrets are now replaced by a fixed `********`; only a public type
  prefix such as `AKIA` or `ghp_` stays visible, and the length isn't revealed either.
- **Format JSON changed numbers:** `12345678901234567890` became `12345678901234567000` and `1.10` became
  `1.1`. Numbers are now copied exactly as written.
- **Dark mode:** pages that already have a dark theme are left alone instead of being turned light; turning it
  off no longer reloads the page; after a reload the popup no longer shows it as on; it is remembered for a
  site only when you tick "Remember", and forgetting a site releases its permission.
- **Shortcuts** moved from Alt+Shift (which switches the keyboard layout on Windows) to **Ctrl+Shift+L** and
  **Ctrl+Shift+K**. The popup shows the shortcuts actually assigned and links to `chrome://extensions/shortcuts`.
- **Silent failures:** on pages Chrome doesn't allow (chrome://, the Web Store, local files without file
  access, the PDF viewer) the popup now says why, and shortcuts and the context menu show a red `!` on the
  toolbar icon with the reason. The popup no longer closes when opening the viewer failed.
- pino and zap logs show a date and a level name instead of an epoch and `30`.
- "Collapse" also merges repeated errors that have the same stack trace.
- Timestamps in syslog, nginx/Apache, Android logcat and epoch formats; Android and `[W]` levels and `DBG`;
  prose like "no error here" is no longer marked as an error.
- Text tools: `tel` and `number` inputs, textareas inside web components, and editors with no selection;
  Esc closes the panel without also reaching the page.
- Cron: `0,7` is Sunday once, backwards ranges and impossible dates (31 February) are reported, 7-field
  Quartz expressions with a year, clearer wording for day steps.
- JWT dates written in milliseconds, micro- and nanosecond timestamps, gaps like `+59m60s`, sorting lines
  with Windows line endings, and Copy buttons when the clipboard is blocked.
- The popup's text box is kept in memory only (`chrome.storage.session`) instead of `localStorage`.

## 0.2.0

### Added

- **Secret detection.** Lines that show AWS keys, GitHub, GitLab, Slack and Stripe tokens, Google API keys,
  JWTs, private keys, passwords in URLs or `password=…` style settings get a 🔑 marker and a highlighted
  value. **Mask** hides them on screen and in copied text; `s` jumps to the next one.
- **Mask secrets** text tool, in the right-click menu and the popup: clean up a log or config before
  pasting it into a chat.
- **Web Worker parsing** for logs over 1 MB, with a progress bar. Pages whose CSP forbids workers fall back
  to parsing in chunks on the main thread, so the tab never freezes.
- **Line inspector**: click a line to see it in full (wrapped), with level, time, pause since the previous
  entry and, for JSON records, every field pretty-printed.
- **Links to lines**: click a line number to copy a `#L120` link; opening the viewer on such a URL jumps to
  that line.
- **Error timeline**: a histogram of entries, errors and warnings over time; click a bar to jump there.
- **Open logs automatically** on sites you choose (opt-in per site, only for plain-text pages that look
  like logs).
- ESLint, Prettier and a Playwright end-to-end test in CI; a release workflow that attaches the ZIP to a
  GitHub Release.

### Changed

- Level filters with no lines are hidden, and the toolbar is more compact.

## 0.1.0

First release: log viewer, per-site dark mode, and text tools (JSON, JWT, Base64, URL, timestamps, cron,
case conversion, line tools).
