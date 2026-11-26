# Publishing a release

## Every release

1. Bump `version` in `src/manifest.json` and `package.json` (the store needs a higher version each time).
2. Add a `## X.Y.Z` section to `CHANGELOG.md`; it becomes the GitHub Release notes.
3. Commit and push, then either click **Actions → release → Run workflow** on GitHub (it creates the
   `vX.Y.Z` tag from the manifest version itself), or tag and push from a terminal:

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

The [release workflow](../.github/workflows/release.yml) then runs lint, unit tests and end-to-end tests in
Chromium and Firefox, builds the ZIPs, creates a GitHub Release with the ZIPs and their `SHA256SUMS`, waits for a
reviewer to approve the `stores` environment, and submits the new version to every store whose secrets are set:

| Store              | Package                         | Goes live after review, usually |
| ------------------ | ------------------------------- | ------------------------------- |
| Chrome Web Store   | `logbeam-<version>.zip`         | a few days                      |
| addons.mozilla.org | `logbeam-firefox-<version>.zip` | a day to a few days             |

A store without secrets is skipped with a notice, and one store failing doesn't stop the other.

If a version is still waiting for review, a store refuses a new upload; wait for the review or cancel it in that
store's dashboard, then re-run the failed `publish` job.

### What runs where

The workflow has three jobs, so that a compromised build tool can't read the store secrets or publish anything:

| Job              | Runs                                                        | Gets                                                         |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| `build`          | `npm ci`, the tests, `npm run package`, writes `SHA256SUMS` | a read-only token, no secrets                                |
| `github-release` | checks `SHA256SUMS`, attests the ZIPs, `gh release create`  | a token that can write releases; no npm, no secrets          |
| `publish`        | `scripts/publish-cws.mjs` and `web-ext sign`                | the store secrets, in the `stores` environment, after review |

`publish` checks out only `scripts/publish-cws.mjs` and `docs/amo-metadata.json`, checks the ZIPs against
`SHA256SUMS` again, and installs nothing from `package-lock.json`: `publish-cws.mjs` uses only Node's own modules,
and web-ext is installed at the version in `WEB_EXT_VERSION` with `--ignore-scripts` (the build warns when it differs
from `package-lock.json`). Only the steps that talk to a store get its secrets. Every action is pinned to a commit
SHA; Dependabot updates them once a month.

## One-time setup: the `stores` environment

The `publish` job of the release and publish workflows, and check-stores, run in a GitHub environment called
`stores`. In the repository: _Settings → Environments → New environment_, name it `stores`, then:

- **Required reviewers**: add yourself. Each release then stops before the stores until you click _Review deployments
  → Approve_ on the run; the GitHub Release already exists by then. Leave _Prevent self-review_ off if you're the only
  maintainer.
- **Deployment branches and tags**: _Selected branches and tags_, add the branch `main` and the tag pattern `v*`
  (`Run workflow` runs from `main`, a pushed tag runs from the tag).
- **Environment secrets**: add the `CWS_*` and `AMO_*` secrets from the sections below here, and delete them from
  the repository secrets. Then only a job in this environment, after approval, can read them.

GitHub creates the environment without any protection the first time a job uses it, so set it up before the next
release.

## One-time setup: Chrome Web Store API access

The workflow needs three GitHub secrets. Without them it still creates the GitHub Release and just skips the store.

1. **Google Cloud project.** Open [console.cloud.google.com](https://console.cloud.google.com/), create a project
   (e.g. `logbeam-publishing`), then go to _APIs & Services → Library_ and enable the **Chrome Web Store API**.
2. **OAuth consent screen.** _APIs & Services → OAuth consent screen_: user type **External**, app name `Logbeam
publishing`, your email as support and developer contact. No scopes need to be added here.
   Then click **Publish app** so its status is _In production_. In _Testing_ status Google expires the refresh
   token after 7 days. An unverified app is fine; you're the only one who will ever sign in to it.
3. **OAuth client.** _APIs & Services → Credentials → Create credentials → OAuth client ID_, type **Desktop app**.
   Copy the client ID and secret.
4. **Refresh token.** In this repository, run:

   ```bash
   CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… node scripts/cws-token.mjs
   ```

   Open the printed link, sign in with the Google account that owns the extension, and click through the
   "Google hasn't verified this app" warning (_Advanced → Go to Logbeam publishing_). The terminal prints the
   refresh token.

5. **GitHub secrets.** In the repository: _Settings → Environments → stores → Add environment secret_:

   | Name                | Value                   |
   | ------------------- | ----------------------- |
   | `CWS_CLIENT_ID`     | the OAuth client ID     |
   | `CWS_CLIENT_SECRET` | the OAuth client secret |
   | `CWS_REFRESH_TOKEN` | the token from step 4   |

The extension ID (`kgjadbnghdgmcafdfgjhgfgcgnnnmcpe`) isn't secret and is set in the workflow.

Treat the refresh token like a password: it lets anyone with the client secret publish new versions of the
extension. To revoke it, remove "Logbeam publishing" at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## One-time setup: addons.mozilla.org (Firefox)

1. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) and accept the developer
   agreement.
2. Create API credentials at [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/): a **JWT
   issuer** and a **JWT secret**.
3. Add them as the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` of the `stores` environment.

The first release creates the listing from [`docs/amo-metadata.json`](amo-metadata.json) (summary, description,
category, licence, notes for the reviewer); add screenshots on the add-on's page afterwards. Because the code is
bundled, every upload includes `logbeam-source-<version>.zip` (made with `git archive`) so reviewers can rebuild it.

To check that the secrets work without publishing anything, run **Actions → check-stores → Run workflow**.

If a store refused a release (for example because the previous version was still in review), send that
version again later with **Actions → publish → Run workflow**: enter the tag (`v0.4.0`) and pick the store. It
sends the release's own ZIPs after checking them against its `SHA256SUMS` (a release from before `SHA256SUMS` is
built from its tag), and waits for approval of the `stores` environment like a release. So does check-stores.

## Verifying a release

Each release has `SHA256SUMS` for its three ZIPs and a signed build provenance attestation, which says which
workflow run on which commit built them. To check a download:

```bash
gh release download v0.11.0 --repo andronaft/Logbeam
sha256sum -c SHA256SUMS            # macOS: shasum -a 256 -c SHA256SUMS
gh attestation verify logbeam-0.11.0.zip --repo andronaft/Logbeam
```

The ZIPs are reproducible: `scripts/package.mjs` sorts the entries and gives each one the time of the last commit
(or `SOURCE_DATE_EPOCH`) and fixed permissions. To rebuild a release yourself and compare:

```bash
git checkout v0.11.0
npm ci
npm run package
sha256sum logbeam-*.zip            # the same as in the release's SHA256SUMS
```

The source ZIP comes from `git archive`, so its bytes can differ with another version of git; the extension ZIPs
can differ with another major version of Node (its zlib compresses them). CI uses Node 22.

## Manual upload

`npm run package` creates `logbeam-<version>.zip` (Chrome) and `logbeam-firefox-<version>.zip`; upload
them in each store's dashboard, e.g. under _Package_ in the
[Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
