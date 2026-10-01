// Uploads a ZIP to the Chrome Web Store and submits it for review, using the Chrome Web Store API.
// Usage: node scripts/publish-cws.mjs <zip>
// Env: CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN (see docs/PUBLISHING.md).
// Set CWS_PUBLISH=false to upload a draft without submitting it.
import { readFileSync } from 'node:fs';

const API = 'https://www.googleapis.com/chromewebstore/v1.1/items';
const UPLOAD_API = 'https://www.googleapis.com/upload/chromewebstore/v1.1/items';

const zipPath = process.argv[2];
const { CWS_EXTENSION_ID: id, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISH } = process.env;
for (const [name, value] of Object.entries({
  zipPath,
  CWS_EXTENSION_ID: id,
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_REFRESH_TOKEN,
})) {
  if (!value) fail(`Missing ${name}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function json(response, what) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`${what} failed (HTTP ${response.status}): ${JSON.stringify(body)}`);
  return body;
}

// 1. A short-lived access token from the long-lived refresh token
const token = await json(
  await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CWS_CLIENT_ID,
      client_secret: CWS_CLIENT_SECRET,
      refresh_token: CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  }),
  'Getting an access token',
);
const auth = { Authorization: `Bearer ${token.access_token}`, 'x-goog-api-version': '2' };

// 2. Upload the new package (replaces the draft)
const upload = await json(
  await fetch(`${UPLOAD_API}/${id}`, { method: 'PUT', headers: auth, body: readFileSync(zipPath) }),
  'Upload',
);
if (upload.uploadState !== 'SUCCESS') {
  const reasons = (upload.itemError ?? []).map((e) => `${e.error_code}: ${e.error_detail}`).join('; ');
  fail(`Upload was not accepted (${upload.uploadState}). ${reasons}`);
}
console.log(`✓ Uploaded ${zipPath} to item ${id}`);

if (CWS_PUBLISH === 'false') {
  console.log('Skipping submission (CWS_PUBLISH=false); the new version waits as a draft in the dashboard.');
  process.exit(0);
}

// 3. Submit for review; it goes live automatically once approved
const publish = await json(
  await fetch(`${API}/${id}/publish`, { method: 'POST', headers: { ...auth, 'Content-Length': '0' } }),
  'Publishing',
);
const status = publish.status ?? [];
if (!status.every((s) => s === 'OK' || s === 'ITEM_PENDING_REVIEW')) {
  fail(`Publishing returned ${status.join(', ')}: ${(publish.statusDetail ?? []).join(' ')}`);
}
console.log(`✓ Submitted for review (${status.join(', ')}). It goes live once Google approves it.`);
