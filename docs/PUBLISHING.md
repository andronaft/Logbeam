# Publishing a release

## Every release

1. Bump `version` in `src/manifest.json` and `package.json` (the store needs a higher version each time).
2. Add a `## X.Y.Z` section to `CHANGELOG.md`; it becomes the GitHub Release notes.
3. Commit, then tag and push:

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

The [release workflow](../.github/workflows/release.yml) then runs lint, unit and end-to-end tests, builds the ZIP,
creates a GitHub Release, and uploads the ZIP to the Chrome Web Store and submits it for review. The new version
goes live by itself once Google approves it, usually within a few days.

If a version is still waiting for review, the store refuses a new upload; wait for the review or cancel it in the
Developer Dashboard, then re-run the workflow.

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

## Manual upload

`npm run package` creates `logbeam-<version>.zip`; upload it under _Package_ in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole).
