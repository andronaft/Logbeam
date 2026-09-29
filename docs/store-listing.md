# Chrome Web Store listing

Text to paste into the Developer Dashboard when publishing.

## Name
Logbeam: log viewer, dark mode & dev tools

## Summary (max 132 characters)
Readable logs with levels, filters and stack traces, dark mode for any site, and JSON / JWT / Base64 / cron tools. 100% local.

## Category
Developer Tools

## Description
Logbeam makes raw logs readable and keeps everyday developer tools one right-click away.

LOG VIEWER (Alt+Shift+L)
• ERROR / WARN / INFO / DEBUG / TRACE in colour, with counters and one-click filters
• Java, Python and Go stack traces stay grouped with their error
• Plain-text and regex search with highlighted matches
• JSON logs (Logstash, pino, bunyan, zap) shown as readable lines
• Pauses between entries (+30.0s) show where the app stalled
• Collapse repeated lines: 500 identical retries become one line with ×500
• Jump to the next error, copy the visible lines
• Fast on 100,000+ lines

DARK MODE FOR ANY SITE (Alt+Shift+D)
• Turn it on for the current tab, or remember it for a site
• Photos and videos keep their real colours

TEXT TOOLS: select text, right-click, then Logbeam
• Format / minify JSON
• Decode JWT with expiry status
• Base64 and URL encode / decode
• Unix timestamp ⇄ date
• Explain cron expressions (Unix and Spring)
• camelCase / snake_case / kebab-case / CONSTANT_CASE
• Sort and de-duplicate lines
• "Replace selection" writes the result back into inputs and editors

PRIVACY
Everything runs locally in your browser. Logbeam has no server and no analytics, and it sends no network requests.

Open source: https://github.com/andronaft/Logbeam

## Single purpose
Help developers read and work with technical text in the browser: view logs, transform selected text, and apply a dark theme.

## Permission justifications
- **activeTab**: run the log viewer or a text tool on the current tab when the user clicks the toolbar icon, a context-menu item or a shortcut.
- **scripting**: inject the log viewer, the text-tool panel and the dark-mode stylesheet into that tab, and register the dark-mode stylesheet for sites the user chose to remember.
- **contextMenus**: the "Logbeam" right-click menu for selected text.
- **storage**: remember the sites that use dark mode.
- **Optional host permissions**: requested for a single site only when the user ticks "Remember for this site", so the dark theme loads before the page paints.

## Data usage
Does not collect or transmit any user data.

## Assets
- Icon: `icons/icon128.png`
- Screenshots (1280×800 or 640×400): take them from `docs/*.png`, resized
- Small promo tile 440×280: optional
