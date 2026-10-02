// Checks the store credentials in GitHub secrets without publishing anything: signs in to each
// store whose secrets are set and reads the extension's status. Never prints the secrets.
// Run it from Actions → check-stores → Run workflow.
import { createHmac, randomUUID } from 'node:crypto';

const env = process.env;
let failed = false;
const ok = (store, message) => console.log(`✓ ${store}: ${message}`);
const bad = (store, message) => {
  console.log(`✗ ${store}: ${message}`);
  failed = true;
};
const missing = (names) => names.filter((name) => !env[name]);

async function chrome() {
  const names = ['CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'];
  if (missing(names).length) return console.log(`- Chrome Web Store: not set (${missing(names).join(', ')})`);
  const token = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  }).then((r) => r.json());
  if (!token.access_token) return bad('Chrome Web Store', `sign-in failed: ${token.error} ${token.error_description ?? ''}`);
  const item = await fetch(`https://www.googleapis.com/chromewebstore/v1.1/items/${env.CWS_EXTENSION_ID}?projection=DRAFT`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }).then((r) => r.json());
  if (item.error) return bad('Chrome Web Store', `signed in, but can't read the item: ${item.error.message}`);
  ok('Chrome Web Store', `signed in; item ${item.id}, upload state ${item.uploadState}`);
}

async function edge() {
  const names = ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];
  if (missing(names).length) return console.log(`- Edge Add-ons: not set (${missing(names).join(', ')})`);
  // there is no read-only endpoint; asking for an operation that doesn't exist tells a bad key (401/403)
  // from a good one (404)
  const response = await fetch(
    `https://api.addons.microsoftedge.microsoft.com/v1/products/${env.EDGE_PRODUCT_ID}/submissions/operations/${randomUUID()}`,
    { headers: { Authorization: `ApiKey ${env.EDGE_API_KEY}`, 'X-ClientID': env.EDGE_CLIENT_ID } },
  );
  if (response.status === 401 || response.status === 403) {
    return bad('Edge Add-ons', `the API key or client ID was rejected (HTTP ${response.status})`);
  }
  ok('Edge Add-ons', `the API key is accepted (HTTP ${response.status} for a test request)`);
}

function amoToken() {
  const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({
    iss: env.AMO_JWT_ISSUER,
    jti: randomUUID(),
    iat: now,
    exp: now + 60,
  })}`;
  return `${unsigned}.${createHmac('sha256', env.AMO_JWT_SECRET).update(unsigned).digest('base64url')}`;
}

async function firefox() {
  const names = ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'];
  if (missing(names).length) return console.log(`- addons.mozilla.org: not set (${missing(names).join(', ')})`);
  const headers = { Authorization: `JWT ${amoToken()}` };
  const profile = await fetch('https://addons.mozilla.org/api/v5/accounts/profile/', { headers });
  if (!profile.ok) return bad('addons.mozilla.org', `the API key was rejected (HTTP ${profile.status})`);
  const addon = await fetch('https://addons.mozilla.org/api/v5/addons/addon/logbeam@zhukovskyi.space/', {
    headers: { Authorization: `JWT ${amoToken()}` },
  }).then((r) => r.json());
  const version = addon.current_version?.version ?? addon.latest_unlisted_version?.version ?? 'none yet';
  ok(
    'addons.mozilla.org',
    `signed in as ${(await profile.json()).name}; add-on status ${addon.status ?? 'not found'}, version ${version}`,
  );
}

for (const check of [chrome, edge, firefox]) {
  try {
    await check();
  } catch (error) {
    bad(check.name, String(error));
  }
}
process.exit(failed ? 1 : 0);
