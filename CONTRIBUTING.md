# Contributing to Logbeam

Thanks for wanting to help! Bug reports, ideas, translations and pull requests are all welcome. Issues labelled
[good first issue](https://github.com/andronaft/Logbeam/labels/good%20first%20issue) are small and say where to
look and when they are done.

## Set up

You need Node.js 22.

```bash
git clone https://github.com/andronaft/Logbeam.git
cd Logbeam
npm ci
npm run watch            # rebuilds dist/ on every change
```

- **Chrome:** open `chrome://extensions`, turn on Developer mode, **Load unpacked** and pick `dist/`. After a
  change, press ↻ on the extension's card and reload the page you test on.
- **Firefox:** `npm run watch:firefox`, then `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
  and pick `dist-firefox/manifest.json`.

`docs/sample.log` is a realistic log to try the viewer on.

## Before you open a pull request

```bash
npm run check            # lint, formatting, types, unit tests and a build: what CI runs first
npm run e2e              # the real extension in Chromium, clicked through by Playwright
```

`npm run format` fixes formatting. CI also runs the end-to-end test in Firefox (`npm run e2e:firefox`, which needs
Firefox and geckodriver locally, so it's fine to leave that one to CI).

## How the code is laid out

- `src/lib/` is the pure core: parsing, filters, diff, secrets, statistics. No DOM and no `chrome.*` here, so
  everything is unit-tested in `test/`. New logic goes here, with tests.
- `src/content/logViewer.ts` is the log viewer; `src/diff/`, `src/options/`, `src/popup/` are the extension's
  own pages. [README → Development](README.md#development) has the full tree.
- `scripts/e2e.mjs` drives the built extension. A user-visible change should get a check there.

## A few rules

- **No network requests, ever.** Logbeam's promise is that nothing leaves the browser. No analytics, no remote
  fonts or scripts, no "check for updates".
- **No new permissions** without talking about it in an issue first. Site access stays optional and per site.
- **Build DOM from nodes** (`el(...)`, `textContent`), never `innerHTML`: the viewer runs on pages that enforce
  Trusted Types, like GitHub.
- **Dark and light**: new styles use the CSS variables, so both themes work.
- **Text people see** goes through `t()` or `data-i18n`, with the English text in the code as the fallback and
  the messages in `_locales/en` and `_locales/uk`. If you don't speak Ukrainian, add the English message there
  too and say so in the pull request; someone will translate it.

## Translations

Copy `_locales/en/messages.json` to `_locales/<language>/messages.json` and translate the `message` values. Keep
`{placeholders}` as they are, and keep labels short: the toolbar has little room. `npm test` tells you if a
message is missing or a placeholder is misspelt. See [#2](https://github.com/andronaft/Logbeam/issues/2).

## Commits and pull requests

- One topic per pull request; small ones get reviewed fastest.
- Say what changes for the user and how you checked it (screenshots help for anything visible).
- Add a line under `## Unreleased` in `CHANGELOG.md` if users will notice the change.

Releases are made by the maintainer: the release workflow tests everything again and publishes to the Chrome Web
Store and Firefox Add-ons.

## Security

Please don't report security problems in public issues; see [SECURITY.md](SECURITY.md).
