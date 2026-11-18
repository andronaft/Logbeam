# Changelog

## Unreleased

### Added

- **Help for the first logs.** The first three logs someone opens show one line of tips made from that log: `e` for
  the next error when there are errors, a field condition it really has (`status>=500`, click to try it), click a
  line, drag the timeline, `?` for all keys. × hides them for good. The search box suggests the same condition
  instead of `time=…`.
- **No more blank page** when the filters leave nothing: the viewer says why ("No lines match “zzzz”") with
  buttons to clear the search, show all levels or all times again.
- **One search for fields, text and words to leave out**: `service=payments timeout -healthz`. Before, a search was
  either all field conditions or all text, and leaving something out took a regex with a negative lookahead. A
  `-word` (or `-"two words"`) leaves out the lines that have it, an error together with its stack trace; `-5` and
  `--verbose` are still text. The status line says how many words are left out.
- **Error groups by first seen.** The Groups panel can list the errors in the order they first happened instead of
  by count, and marks the earliest one "first" either way: 900 × `upstream timeout` are often the symptom of the one
  `pool exhausted` three seconds before them.
- **Hide lines like this** (`x`, or the ⊘ button in the line details): every line of the selected kind, e.g.
  `GET /healthz 200 in 3ms`, leaves the view, with its stack trace, in every pod or file. Numbers, IDs and times
  don't count, the level does, so the 503 marked ERROR stays. Each hidden kind gets a chip with its count; click it
  or press `X` to bring the last one back. The status line says how many lines are hidden, and the view link
  keeps them (`#mute=12`).
- **A minimap next to the scrollbar** marks every error, warning and bookmark in the shown lines, so in a long
  log you see at a glance where the trouble is. Click or drag on it to go there; a box shows the part on screen.
- **`w` jumps to the next warning**, like `e` does to the next error.
- **Open several logs as one.** Drop or choose two or more files (`api.log`, `worker.log`, the same service on
  three machines) and Logbeam merges them in order of time into one log, with the file name in front of each line
  and a coloured chip per file to show or hide it, as with pods. Stack traces and pretty-printed JSON stay with
  their entry, each file keeps its own order, and a file without timestamps goes at the end. Everything else works
  on the merged log as usual: filters, the timeline, error groups, links and Compare.
- **A link opens the same view.** The address now keeps what narrows the log: the shown levels, the search
  (also a regex or a field filter), the time range and the pods, next to the selected line:
  `…/build.log#L120&levels=ERROR,WARN&q=payments`. Send it, and your colleague sees "the errors from the
  payments pod after 10:05" instead of setting the same filters again. 🔗 in the toolbar or `y` copies the link;
  reloading the page keeps the view. `#L120` links from older versions work as before, and a page's own
  `#anchor` is left alone (#10).
- **Select a range of lines.** Click a line, then **Shift+click** another one (or press `J` / `K`) to select
  everything in between, like `#L120-L135` on GitHub. The inspector shows how many lines that is and how long
  they took, with **Copy lines** and **Copy link**; the link opens with the range selected, scrolled into view
  and its folded section open. Shift+click a line number to copy the link at once (#11).
- **Follow one request.** Click a line and the inspector offers its IDs: `traceId`, `request_id`, `orderId`,
  UUIDs and W3C trace IDs. Click one to see every line of that request across pods and services, with a
  summary like "3 entries · 3 pods · over 2.2s". Short IDs (`userId=42`) are followed as their field, so they
  don't match inside other numbers.

### Improved

- **A calmer toolbar.** The buttons are in groups (levels, search, view, jumps, actions) that wrap as a whole,
  the level chips have a coloured dot and are crossed out when hidden, and the actions you use now and then
  (Follow, Copy, Save, Raw) stay quiet until you point at them. Buttons show a focus ring for the keyboard.
- **Errors and warnings are marked next to the line number**, so you still see the level of a line when it is
  scrolled sideways, and the pauses (`+30.0s`) stay in view too. The selected line gets an accent mark. With
  Gaps off, their empty column no longer takes 64 pixels.
- **Many more log formats are read as they come.** Tried on one real line of each of 80 formats, Logbeam found
  the level and the time in 25; now in all of them:
  - servers: nginx and Apache error logs (`[crit]`, `[core:error]`), PostgreSQL (`LOG:`), MySQL (`[Note]`), Redis,
    MongoDB, syslog priorities (`<34>`), and **access logs, which get their level from the status**: 5xx is an
    error, 4xx a warning;
  - applications: .NET (`fail:`, `crit:`, `dbug:`), Serilog (`[10:00:00 INF]`), Laravel and Symfony
    (`production.ERROR:`), PHP (`PHP Fatal error:`), Celery, zap and winston (`error` after the timestamp);
  - Kubernetes: klog (`E1004 10:00:01.000000`), container log files (`… stderr F …`), Docker's json-file, and
    Google Cloud's `EMERGENCY` and `ALERT` severities;
  - **CI logs**: failed tests and builds are errors (`FAIL src/pay.test.ts`, `--- FAIL: TestCharge`,
    `FAILED tests/test_pay.py`, `BUILD FAILED`), and so are `npm ERR!`, compiler and linter errors
    (`main.c:12:5: error:`, `error TS2304:`, `error[E0425]`), Terraform's `│ Error:` and `::error`. So `e` jumps
    to them, and Compare lists them among the new errors.
- **Logs with only a time** (`10:00:00.123 [main] INFO …`, Logback's default pattern) get pauses and a timeline,
  also over midnight. More dates are read too: PHP, Redis, the Apache error log, `java.util.logging`.
- A JSON record without a level field takes the level from its message, and a message with line breaks stays
  on one row (`⏎` marks the breaks).
- **The viewer remembers how you left it**: Collapse, Gaps, Timeline, Mask and Context stay as they were for the
  next log, so if you always mask secrets, you turn Mask on once.
- **Screen readers**: toggles, level filters and pod chips say whether they are on (`aria-pressed`), and the icon
  buttons (`.*`, `Aa`, 🖍, 🔗, `?`) have names.
- **One look across the popup, Settings and Compare**: they share the same colours, corners and sizes, and grey
  text is easier to read in both themes (line numbers too). Toggles that are on are tinted and bold, hidden level
  chips are easier to read, and every button and the Context menu show a focus ring for the keyboard. Compare no
  longer shows an empty box where the list of new errors goes.
- **The popup**: "Open as log" is the main button, the text tools are in small groups (JSON, tokens & time;
  Encode & decode; Case & lines), and a result no longer looks like a button. **Settings**: a smaller title with
  "Saved ✓" next to it instead of in the corner, and quieter "+ Add" buttons. The panel of the right-click tools
  follows the system's light or dark mode.

### Fixed

- **Follow no longer drops a big batch of new lines.** About 125k new lines at once failed with "Maximum call stack
  size exceeded", and those lines never showed up, not even later.
- **Collapse no longer breaks every filter** on a log with one entry of over about 125k lines (a huge dump under one
  header).
- **Faster on big logs.** With Collapse on, every click and key on a 600k-line log took about 0.9 s; now about 0.1–0.2 s
  (each line's signature is worked out once). The minimap is drawn in one pass, field filters skip lines without
  the key, and a row shows the first 5,000 characters of a very long line (the line details show all of it).
- `e`, `w`, `s` and `b` say what is missing instead of "Nothing found": no errors in this log at all, or errors that
  the filters hide. A timeline bar says "1 entry", not "1 entries", and how to drag a range.
- Changing settings quickly no longer leaves the right-click menu half built ("duplicate id"), and saving the viewer's view no longer rebuilds the menu at all.
- Remembering dark mode or auto-open for a site no longer fails with "duplicate script id" when Logbeam syncs its sites
  at the same time, or when the popup and the background both finish the request after the permission prompt.
- GELF records show their level (syslog 3 = ERROR, 4 = WARN, …) and their `short_message` instead of TRACE and a JSON blob.
- The text-tool panel on a page and the popup's copy and shortcut labels are translated.
- Colourful CI logs that end colours with `tput sgr0` (`ESC ( B`) show clean text and keep their level.
- A click on a field value in the field panel works for keys like `k8s/app` or `user:id` (written `"k8s/app"=web`),
  and for values with a `*` in them: a quoted value is matched as it is, `*` is a wildcard only without quotes.
- Dark mode leaves sites alone that are already dark with `oklch()`, `lab()` or `color(srgb …)` backgrounds
  (Tailwind 4) instead of turning them light.
- Compare says when a log is too big to keep (over about 10 MB) instead of doing nothing, and reads `.gz` files.
- A time range picked on the timeline keeps the same entries in a link.
- The timestamp tool reads nanoseconds to the exact millisecond; the JWT tool explains a `null` payload instead of
  failing; the case tools split `caféBar` into `café_bar`.
- **Bookmarks and notes on a web page survive a reload** again (while the browser is open). They were lost,
  because a content script may not use the extension's session storage; the background page keeps them now.
- **Follow no longer steals the focus** from a bookmark note every 3 seconds (the rest of what you typed became
  shortcuts: `e`, `m`…), and field statistics in the inspector stay open while new lines come in.
- **Follow works on logs with Windows line ends** (CRLF) instead of saying at once that the log was replaced.
- A time range dragged up to the last bar of the timeline dropped the last entry, often the "exited with code 1".
- Opening a log without timestamps no longer turns the Timeline off for the next logs.
- A regex search on a page whose CSP blocks workers no longer ends in "took over 2s": it searches on the page.
  Typing a regex quickly over a big log no longer times out valid searches waiting behind each other.
- A file dropped onto a viewer on a web page: Follow, Link and the address belong to the page, so they are off.
- Settings no longer undo the time zone or the view you chose in the viewer while the Settings page was open.
- The viewer page opened every later dropped file twice, and an old log's search worker stayed in memory after
  another log was opened.
- **A JSON log with nanosecond or microsecond times** (`"ts": 1727604000123456789`, Go and OpenTelemetry) no longer
  fails to open, and microseconds no longer show as the year 56715.
- **`level=error` finds the errors of pino and bunyan logs**, whose level is a number (`"level": 50`).
- **Mask secrets** now masks a quoted password with an escaped quote in it (`"pa\"ss"`), which it used to leave
  in full or half, and a short password cut by `,` or `;` (`password=Pa;ssw0rd!`).
- A JSON record with an object under `event` showed `[object Object]`; fields like `severity` next to a `level`
  were dropped from the line.
- A search like `x*` or `colou?r|` found lines but didn't highlight the matches in them.
- Explain cron: a weekday in the 7-field Quartz form counts from Sunday = 1 (`2` is Monday), and `-5`, `0x1F` or
  `1e1` are refused instead of read as numbers.
- Durations no longer round up to `60s` or `1000ms` (in field statistics and JWT expiry).
- Compare (JSON) saw no change when a key like `constructor` was added; a changed emoji is no longer cut in half.
- A custom secret pattern like `(.*a){12}` is refused as too slow, like `(a+)+` already was.
- `2026-02-30` is not read as March 2; a bookmarked line with three backticks no longer breaks the Report; a JWT
  with an impossible date says so instead of failing.
- Opening or dropping another file no longer jumps to the line that was selected in the log before it.

## 0.9.0

### Added

- **Ukrainian** everywhere: the log viewer (toolbar, tooltips, inspector, toasts), Compare, Settings and the
  page for pasted text and files. Counts use the right plural form (`1 рядок`, `3 рядки`, `5 рядків`)
  (#1, translated by @o-shpatakovska in #7).
- **Move between lines** with `j` / `k`, and to the first or last line with `g` / `G` (#8, thanks @Zekuath).
- **Context around search matches**, like `grep -C`: show 2, 5 or 10 lines before and after each match, dimmed,
  with a line between groups; the status line still counts the matches (#9, thanks @Zekuath).
- **Export the JSON table as CSV**: with **Table** on, **Save** downloads the shown rows with the chosen columns
  (#12, thanks @Zekuath). Cells that a spreadsheet would run as a formula (`=…`, `+…`, `@…`) are made plain text.

## 0.8.0

### Added

- **GitHub Actions sections.** The `##[group]` … `##[endgroup]` sections of a raw GitHub Actions log are folded
  like in GitHub, with their size and error count; the ones with errors start open. Click ▸ to open one, or
  **Sections** to open or close them all. A search looks inside closed sections too (#14, suggested on Reddit).
- **For contributors**: a contributing guide, a security policy, issue and pull request templates.

### Improved

- A `##[group]` or `::group::` line starts an entry of its own, so a log without timestamps doesn't carry the
  last level into the next section.

## 0.7.0

### Added

- **New errors in Compare.** Compare two runs of a CI job, and above the diff Logbeam lists the errors
  that are new in the second one, with how often they happened; the ones that are gone are listed apart.
  Errors are matched by message and first stack frames, with times, numbers and IDs ignored. Click one
  to jump to it in the diff (#13).

### Improved

- **Jenkins consoles.** Logs without timestamps no longer carry the last level on to every line after
  it: `[Pipeline]` steps and the `+ command` lines Jenkins echoes start entries of their own, and a bare
  `java.lang.…Exception:` line is an error.
- **IDs in hex.** Short commit SHAs and cache keys (`41aa0be`, `node-modules-9f2c71d`) are ignored by
  "Ignore timestamps, IDs and durations" in Compare, and by error groups and collapsed repeats.

## 0.6.0

### Added

- **ANSI colours** in logs from CI runners, Docker and CLIs are drawn as colours, and the escape codes no
  longer get in the way of levels, times, search and filters (#3).
- **Your own level words** in Settings, e.g. `ALERT` → ERROR or `AUDIT` → INFO (#6).
- **Light theme** for the log viewer, Compare, Settings and the popup: like the system, or always dark or
  light (#5).
- **Keyboard shortcuts list**: press `?` (or the **?** button) in the log viewer to see its keys (#4).
- **Percentiles for numbers and durations.** Field statistics of a field like `took=154ms` or
  `"duration": 950` also show min, median, p95, p99 and max; click one to see only the entries at or
  above it (`took>=1.2s`).

### Fixed

- Typing a bookmark note or table columns no longer triggers the viewer's keys: an `e` in the note
  jumped to the next error and lost what was typed.
- Esc in the search box could be undone 150 ms later by the search still waiting for typing to stop.
- The end-to-end test expected numbers formatted for the machine's locale.

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
