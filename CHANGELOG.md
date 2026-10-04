# Changelog

## 0.5.0

### Added

- **Bookmarks and notes.** Press `m` (or ★ Bookmark in the inspector) to bookmark a line and add a note;
  `b` jumps between bookmarks. **Report** copies them as Markdown for a ticket: each line with its time,
  the pause since the previous one, your note and a link to the line.
- **Field statistics.** The inspector lists a line's fields; click one to see its most common values in the
  shown lines (`status: 200 ×1520, 502 ×37`), and click a value to filter by it.
- **Error groups.** **Groups** lists each different error once: how often it happened, in which pods, and
  between which times. Click a group to see only that error and its stack traces.
- **Follow** a log that is still being written (a running CI job, a Jenkins console): the page is read
  again every 3 seconds and new lines are added; the view stays at the bottom if it was there.
- **JSON table**: for JSON logs, **Table** shows time, level, service and message as columns (choose
  others in the Columns box); the remaining fields follow on the same row.
- **Local time**: the UTC button switches timestamps with a zone, the inspector, the timeline and reports
  to your time zone, and remembers the choice.
- **Ukrainian**: the popup, the right-click menu, the shortcuts and the extension's description, with
  the translation files in `_locales` for more languages.

### Fixed

- The popup's Copy and Use as input buttons showed before there was any result.

## 0.4.0

### Added

- **Filter by fields**: type `level=error service=payments duration>500` in the search box. Works on JSON
  logs and on `key=value` lines alike, with `=`, `!=`, `>`, `<`, `>=`, `<=`, `*` wildcards, nested JSON
  paths (`http.status>=500`) and units (`duration>1.5s`). The search box suggests the log's field names.
- **Pick a time range on the timeline**: drag across the bars to keep only the entries from that time;
  the ⏱ chip shows the range and brings everything back.
- **Highlights**: press Enter in the search box (or 🖍) to keep a term highlighted in its own colour, up
  to five at once, e.g. an order ID in yellow and a user ID in blue.
- **Pods and containers**: `kubectl logs --prefix` and `docker compose logs` output gets a coloured chip
  per pod or container to show or hide its lines, and levels and times are read after the prefix.
- **Open pasted text or files**: "Open text as log" in the popup opens a log pasted from Slack or a ticket,
  and "Open a log file…" opens `.log` files and **gzip (`.gz`) files**, which are unpacked in the browser.
  A file can also be dropped onto any open viewer.
- **Save** the visible lines as a file.
- **Settings page**: the pause threshold, your own secret patterns (for internal token formats), and
  which text tools appear in the right-click menu.

## 0.3.0

### Added

- **Compare two logs or JSON documents.** A new Compare page (popup → "Compare two texts or logs…") shows
  what changed line by line, marks the changed words, and folds unchanged parts. JSON is compared by key, so
  key order doesn't matter, with a list of changed paths like `$.env.LOG_LEVEL`. **Ignore timestamps, IDs and
  durations** compares two runs of the same CI job and shows only what really happened differently.
- **Compare…** in the right-click menu and a **Compare** button in the log viewer: use it on one log, then on
  the other, and the Compare page opens with both. Files can be opened or dropped on the page too.
- **Multi-line JSON log records.** A record printed over several lines (`JSON.stringify(record, null, 2)`, or
  `Request body: {` followed by the JSON) is one entry: it takes the record's level and time, its fields
  are in the inspector, and filtering and Collapse keep its lines together.
- **Firefox build** (Firefox 140+), tested in Firefox on every change. The dark-mode shortcut there is
  Ctrl+Shift+. because Ctrl+Shift+K opens the Web Console.
- Releases are also published to **addons.mozilla.org**.

### Changed

- Messages about pages an extension can't run on name Edge, Firefox and Opera pages and stores too, and the
  shortcut link in the popup opens the right settings page in each browser.

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
