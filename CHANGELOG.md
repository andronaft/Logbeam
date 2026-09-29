# Changelog

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
