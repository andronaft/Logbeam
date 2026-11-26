# Ideas

Where Logbeam could go next, from brainstorms written in different roles: an on-call SRE, a first-time user, a CI
engineer, a performance engineer, a security reviewer and a competitor analysis (lnav, klogg, Grafana Explore,
Datadog, Kibana, the GitHub Actions log page). Nothing here needs a server, an account or AI: everything runs in the
browser, like the rest of Logbeam.

Sizes: **S** an afternoon, **M** a few days, **L** a week or more. Pick one, open an issue first if it is M or L.

## Being built

| Idea                                                                                                                 | Size | Branch                 |
| -------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------- |
| **Show around** (`c`): a filtered line among all the lines, a chip puts the filters back                             | S    | `feat/around-and-goto` |
| **Go to a time** (`t`): type `10:05:30` from an alert                                                                | S    | `feat/around-and-goto` |
| **Mask everywhere**: field stats, table, CSV, Report, error groups; no secrets in the address; 15 more token formats | M    | `fix/secret-leaks`     |

## CI logs

| Idea                                                                                                                                                                                                 | Size | Notes                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------- |
| **Steps for every CI platform, with durations**: GitLab `section_start`, Azure `##[section]`, Buildkite `---`/`+++`, Jenkins `[Pipeline] { (Stage)`, BuildKit `#12 DONE 41.3s`; ✖ on the failed step | M    | GitLab splits titles with a lone `\r` |
| **Why it failed** card: failed step, exit code, first error, first failing test, one key each                                                                                                        | S    | after the steps                       |
| **Failed tests panel**: pytest, Jest, Go, surefire, Gradle, RSpec in one list, the first one marked                                                                                                  | M    |                                       |
| **Compare per step and per test**: `npm ci 38s → 4m 02s`, new failing tests                                                                                                                          | M    | builds on Compare                     |
| **Flaky hints**: a test that failed and then passed in the same log, `RERUN`, `Flakes: 1`                                                                                                            | S–M  |                                       |
| **CI noise presets**: one click hides download progress, layer pulls, `npm WARN deprecated`                                                                                                          | S    | built on hide lines like this         |
| **Relative job time**: `+04:12` since the job (or step) started instead of the long timestamp                                                                                                        | S    |                                       |
| **Copy failure for a PR**: step, exit code, failed tests, first error with context, as Markdown                                                                                                      | S    |                                       |
| **Annotations by file**: `::error file=…,line=…`, `a.ts(12,5): error TS…`, `main.c:12:5: error:`                                                                                                     | S    |                                       |
| **Matrix jobs**: drop `test (node 18)` and `test (node 20)` and see the failures they share                                                                                                          | M    | built on several logs as one          |

## Incidents

| Idea                                                                                                                                            | Size | Notes                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------- |
| **Split at a time**: what is new after 10:05 (the deploy) and what got louder, inside one log                                                   | S–M  | builds on `diffErrors`       |
| **Incident summary**: time window, pods, counts by level, top error groups, the longest pauses, as Markdown under Slack's limit, secrets masked | M    |                              |
| **Timeline of a field**: p95 of `duration` per minute, or the share of `status>=500`                                                            | M    |                              |
| **Restarts and runs**: mark where an app started and died (`Started X in`, `OutOfMemoryError`, `exit code 137`), `r` to the next                | S–M  | needs your own patterns too  |
| **Patterns for every level**, not just errors, with Include / Exclude per pattern                                                               | M    | Datadog and Grafana have it  |
| **Local baseline**: pin a green run; later logs from the same URL pattern say "2 new errors since baseline"                                     | M    | stores only error signatures |
| **Relative time**: "+1.2 s from the selected line" while moving through lines                                                                   | S    |                              |
| **Saved filters**: named sets like "payments errors"                                                                                            | S    | the view link nearly is one  |
| **Notify in Follow** when a new kind of error appears                                                                                           | S    |                              |

## Big logs

| Idea                                                                                                          | Size | Notes                                           |
| ------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------- |
| **Faster first rows**: send parsed lines from the worker in chunks; counts, timeline and groups in the worker | M    | 600k lines block 0.9 s today                    |
| **Follow only the new bytes**: HTTP `Range`, and counts, timeline and groups for the new lines only           | M    | Follow downloads the whole file every 3 s today |
| **Past 1.7 million lines**: Chrome caps an element at 33.5M px; scale the scroll area                         | S–M  |                                                 |
| **Plain search in the worker**, or only within the last results while typing                                  | S    | 0.1 s per key at 600k                           |
| **One copy of the text**: the log is kept as one string and as lines (and again in the search worker)         | M    | memory is ~2.4× the file                        |

## Newcomers and copy

| Idea                                                                                                   | Size | Notes |
| ------------------------------------------------------------------------------------------------------ | ---- | ----- |
| **The popup on a log page** leads with "Open this log", on other pages with the text tools             | S    |       |
| **Not a log?** A page with no levels and no times says so, with a way back                             | S    |       |
| **Compare**: "Ignore timestamps, IDs and durations" on for logs, a line on what the new-errors list is | S    |       |
| Rename **Raw** to "Original page" and **Gaps** to "Pauses"                                             | S    |       |
| A mouse section in the `?` sheet: click a line, a line number, a traceId, drag the timeline            | S    |       |

## Security and privacy

| Idea                                                                                                             | Size | Notes                                     |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------- |
| **Compare gets masked text** when Mask is on, and its own Mask box starts checked                                | S    |                                           |
| **Bookmarks per tab**: the background lets a script read only its own page's bookmarks                           | S    |                                           |
| **Synced site lists**: check registered scripts against the list on start and on change, release what isn't used | S–M  | a second browser can prune the list today |
| **A declined permission** forgets the pending request                                                            | S    |                                           |
| **Leaner view links**: line numbers and levels by default, the search only when asked                            | S    |                                           |
| **The viewer in its own page** for HTML pages, out of reach of the page's scripts                                | M    |                                           |

## Code

| Idea                                                                                                  | Size   | Notes                          |
| ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| Move the line inspector out of `logViewer.ts` ([#28](https://github.com/andronaft/Logbeam/issues/28)) | M      | `logViewer.ts` is ~1,900 lines |
| More languages ([#2](https://github.com/andronaft/Logbeam/issues/2))                                  | S each |                                |

## Not doing

- **A query language** (SQL, LogQL, KQL): field filters and statistics cover daily debugging, and a language is a wall
  for a tool you open in passing.
- **A server**: live tail through a backend, saved views in the cloud. It would break the no-network promise.
- **"Summarize with AI"**: same promise, and it would make people doubt the privacy claim.
- **Logs of many gigabytes**: browser memory sets the limit; say it clearly instead.
- **Parsers written as code by users**: keep custom rules declarative (level words, secret patterns).
