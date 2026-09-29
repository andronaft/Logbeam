<p align="center">
  <img src="icons/logo512.png" width="96" alt="Logbeam logo">
</p>

<h1 align="center">Logbeam</h1>

<p align="center"><b>Make logs readable again.</b></p>

<p align="center">
  <a href="https://github.com/andronaft/Logbeam/actions/workflows/ci.yml"><img src="https://github.com/andronaft/Logbeam/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

A Chrome extension for developers and platform engineers: a fast log viewer, dark mode for any site,
and the text tools you keep opening random websites for (JSON, JWT, Base64, timestamps, cron). All of it
runs locally; no data leaves your browser.

<p align="center">
  <img src="docs/log-viewer.png" alt="Logbeam log viewer: levels in colour, grouped stack trace, pauses between entries" width="860">
</p>

## Features

### 🔦 Log viewer
Open any raw log (a `.log` file, "View raw logs" in GitHub Actions, Jenkins console output, `kubectl logs`
piped to a file…) with **Alt+Shift+L** or from the popup:

- **Levels in colour** (`ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`) with counters and one-click filters
- **Stack traces stay with their error**: Java `at …` / `Caused by:`, Python tracebacks and Go goroutines are
  grouped with the entry above, so filtering by `ERROR` shows the whole trace
- **Search** as plain text or **regex**, case-sensitive if you like, with highlighted matches
- **JSON logs** (Logback/Logstash, pino, bunyan, zap…) shown as `time LEVEL message {fields}`
- **Pauses between entries**: `+5.5s` next to lines where the app stalled
- **Collapse repeats**: 500 × `retry 17 of 50 for job 8123` becomes one line with a `×500` badge
- **Next error** (`e`), search (`/`), copy visible lines, back to raw
- Smooth on **100k+ lines**: only the rows on screen are in the DOM

<p align="center"><img src="docs/log-viewer-filtered.png" alt="Only errors and warnings, repeated retries collapsed" width="860"></p>

### 🌙 Dark mode for any site
Toggle it from the popup or with **Alt+Shift+D**. "Remember for this site" asks for access to **that one
site only**, and from then on the dark theme is applied before the page paints, so there's no white flash.
Photos and videos keep their real colours.

### 🧰 Text tools
Select text on any page → right-click → **Logbeam**, or paste it into the popup:

| Tool | Example |
|---|---|
| Format / minify JSON | `{"a":1}` → pretty-printed, or back to one line |
| Decode JWT | header, payload, `iat`/`exp` as dates, "valid for another 59m" / "EXPIRED 3h ago" |
| Base64 encode / decode | UTF-8 safe, understands URL-safe Base64 without padding |
| URL encode / decode | `a b&c` ⇄ `a%20b%26c` |
| Timestamp ⇄ date | `1700000000` → `2023-11-14T22:13:20Z`, and back |
| Explain cron | `0 */15 * * * *` → "Every 15 minutes"; catches `*/900` in the seconds field |
| Case conversion | `userProfileId` ⇄ `user_profile_id` ⇄ `user-profile-id` ⇄ `USER_PROFILE_ID` |
| Sort / de-duplicate lines | |

In an input, textarea or rich editor, **Replace selection** writes the result back in place (undo works).

<p align="center">
  <img src="docs/jwt.png" alt="Decoding a JWT from the page" width="560">
  <img src="docs/popup.png" alt="Popup with dark mode and text tools" width="250">
</p>

## Privacy and permissions

Logbeam has no server and no analytics, and it makes no network requests.

| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Run the log viewer or a text tool on the tab you clicked, only when you ask |
| `contextMenus` | The right-click menu |
| `storage` | Remember which sites use dark mode |
| optional host access, per site | Only when you tick "Remember for this site", and only for that site |

Logbeam never asks for access to all sites up front.

## Install

**From source** (until the Chrome Web Store listing is live):

```bash
npm ci
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `dist/`
folder. To open local `file://` logs, also enable **Allow access to file URLs** on the extension's details page.

## Development

```bash
npm run watch        # rebuild on change, then press ↻ on chrome://extensions
npm test             # unit tests (Vitest)
npm run typecheck    # strict TypeScript
npm run package      # dist/ → logbeam-<version>.zip for the Chrome Web Store
npm run icons        # regenerate the PNG icons (drawn in code, no image editor needed)
npm run screenshots  # load the extension into Chromium with Playwright, click through it, save docs/*.png
```

```
src/
├── background.ts        service worker: context menu, keyboard shortcuts, permission events
├── content/
│   ├── logViewer.ts     virtualized log viewer, injected on demand
│   └── panel.ts         result panel for the text tools (Shadow DOM, no style clashes)
├── lib/                 pure logic, fully unit-tested
│   ├── logs.ts          level/timestamp/JSON parsing, stack-trace grouping, filters, repeats
│   ├── transforms.ts    JSON, JWT, Base64, URL, timestamps, case, lines
│   └── cron.ts          cron → plain English (5 and 6 field, macros, names)
├── shared/
│   ├── darkMode.ts      per-site dark mode with dynamic content scripts
│   └── inject.ts        on-demand script injection
├── popup/               toolbar popup
└── dark.css             the dark theme itself
```

### Design notes

- **Least privilege.** Everything works through `activeTab` on a click or a shortcut. Remembered dark-mode
  sites use `chrome.permissions.request` for a single origin plus `chrome.scripting.registerContentScripts`,
  so the extension never holds `<all_urls>`.
- **Manifest V3 service worker.** The worker can be stopped at any time, so state such as remembered sites,
  tab-only dark mode and pending permission requests lives in `chrome.storage`, not in variables.
- **Trusted Types safe.** The viewer and panel build DOM nodes rather than assigning `innerHTML`, so they work
  on sites that enforce Trusted Types, like GitHub and Google.
- **Pure core.** Parsing and transforms have no DOM or `chrome.*` dependencies, which keeps them easy to test.

## Roadmap

- [ ] Open `text/plain` logs in the viewer automatically (opt-in per site)
- [ ] Secret detection: warn when a page shows AWS keys, JWTs or passwords
- [ ] Parsing large logs in a Web Worker
- [ ] Multi-line JSON log records
- [ ] Firefox build

## License

[MIT](LICENSE)
