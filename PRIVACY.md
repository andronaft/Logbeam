# Logbeam Privacy Policy

_Last updated: September 29, 2026 (version 0.2.0)_

Logbeam is a Chrome extension that runs entirely in your browser.

## Data we collect

**None.** Logbeam has no server, no analytics and no tracking, and it makes no network requests.

## Data processed on your device

- **Page text.** When you open the log viewer or use a text tool (Format JSON, Decode JWT, …), Logbeam reads
  the page text or your selection _inside your browser_ to show the result. The text is never stored or sent anywhere.
- **Secret detection.** Looking for keys, tokens and passwords in a log also happens only inside your browser;
  nothing found is stored or sent anywhere.
- **Settings.** The lists of sites where you chose "Remember dark mode" or "Open logs automatically" are saved with `chrome.storage.sync`.
  If Chrome sync is on, Google syncs this list between your own browsers, as it does for all extension settings.
  Logbeam itself never receives it.
- **Clipboard.** The "Copy" buttons write to your clipboard only when you click them.

## Permissions

| Permission                | Used for                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`, `scripting`  | Running the log viewer or a text tool on the current tab when you click, use the context menu or press a shortcut                                                               |
| `contextMenus`            | The "Logbeam" right-click menu                                                                                                                                                  |
| `storage`                 | Remembering your dark-mode sites                                                                                                                                                |
| Optional access to a site | Requested only when you turn on "Remember dark mode" or "Open logs automatically" for a site, and only for that site. You can revoke it at any time in the extension's settings |

## Sharing

Logbeam does not sell, share or transfer any user data to anyone.

## Contact

Questions or concerns: [open an issue](https://github.com/andronaft/Logbeam/issues).
