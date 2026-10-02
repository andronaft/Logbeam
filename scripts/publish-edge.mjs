// Uploads a ZIP to Microsoft Edge Add-ons and submits it for certification (Add-ons API v1.1).
// Usage: node scripts/publish-edge.mjs logbeam-0.2.1.zip
// Env: EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY (see docs/PUBLISHING.md).
// The first version has to be submitted by hand in Partner Center; the API only updates it.
import { readFileSync } from 'node:fs';

const API = 'https://api.addons.microsoftedge.microsoft.com/v1/products';

const zipPath = process.argv[2];
const { EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID, EDGE_API_KEY } = process.env;
for (const [name, value] of Object.entries({ zipPath, EDGE_PRODUCT_ID: productId, EDGE_CLIENT_ID, EDGE_API_KEY })) {
  if (!value) fail(`Missing ${name}`);
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const auth = { Authorization: `ApiKey ${EDGE_API_KEY}`, 'X-ClientID': EDGE_CLIENT_ID };

/** Starts an operation and returns its ID from the Location header. */
async function start(path, init) {
  const response = await fetch(`${API}/${productId}${path}`, { method: 'POST', ...init, headers: { ...auth, ...init.headers } });
  if (response.status !== 202) fail(`${path}: HTTP ${response.status} ${await response.text()}`);
  const location = response.headers.get('location') ?? '';
  return location.split('/').pop();
}

/** Polls an operation until it finishes; returns its final status object. */
async function wait(path) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${API}/${productId}${path}`, { headers: auth });
    const body = await response.json().catch(() => ({}));
    if (body.status && body.status !== 'InProgress') return body;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  fail(`${path}: still in progress after 5 minutes`);
}

const uploadId = await start('/submissions/draft/package', {
  headers: { 'Content-Type': 'application/zip' },
  body: readFileSync(zipPath),
});
const upload = await wait(`/submissions/draft/package/operations/${uploadId}`);
if (upload.status !== 'Succeeded') fail(`Upload failed: ${upload.message} ${JSON.stringify(upload.errors ?? '')}`);
console.log(`✓ Uploaded ${zipPath} to Edge Add-ons`);

const notes = `Release built from https://github.com/andronaft/Logbeam (tag ${process.env.TAG ?? 'unknown'}).`;
const publishId = await start('/submissions', { headers: { 'Content-Type': 'text/plain' }, body: notes });
const publish = await wait(`/submissions/operations/${publishId}`);
if (publish.status !== 'Succeeded') fail(`Submission failed: ${publish.errorCode} ${publish.message}`);
console.log('✓ Submitted for certification. It goes live once Microsoft approves it.');
