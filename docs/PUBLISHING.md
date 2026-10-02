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
Chromium and Firefox, builds the ZIPs, creates a GitHub Release, and submits the new version to every store whose
secrets are set:

| Store              | Package                         | Goes live after review, usually |
| ------------------ | ------------------------------- | ------------------------------- |
| Chrome Web Store   | `logbeam-<version>.zip`         | a few days                      |
| addons.mozilla.org | `logbeam-firefox-<version>.zip` | a day to a few days             |

A store without secrets is skipped with a notice, and one store failing doesn't stop the other.

If a version is still waiting for review, a store refuses a new upload; wait for the review or cancel it in that
store's dashboard, then re-run the workflow.

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

5. **GitHub secrets.** In the repository: _Settings → Secrets and variables → Actions → New repository secret_:

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
3. Add them as the GitHub secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.

The first release creates the listing from [`docs/amo-metadata.json`](amo-metadata.json) (summary, description,
category, licence, notes for the reviewer); add screenshots on the add-on's page afterwards. Because the code is
bundled, every upload includes `logbeam-source-<version>.zip` (made with `git archive`) so reviewers can rebuild it.

To check that the secrets work without publishing anything, run **Actions → check-stores → Run workflow**.

## Manual upload

`npm run package` creates `logbeam-<version>.zip` (Chrome) and `logbeam-firefox-<version>.zip`; upload
them in each store's dashboard, e.g. under _Package_ in the
[Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).
