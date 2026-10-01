// One-time helper: gets the refresh token the release workflow uses to publish to the Chrome Web Store.
// Usage: CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... node scripts/cws-token.mjs
// Opens a Google sign-in in your browser; sign in with the account that owns the extension.
import { createServer } from 'node:http';

const { CWS_CLIENT_ID: clientId, CWS_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('Set CWS_CLIENT_ID and CWS_CLIENT_SECRET first (an OAuth client of type "Desktop app").');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('Waiting for Google…');
    return;
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const body = await response.json();
  if (body.refresh_token) {
    res.end('Done. You can close this tab and go back to the terminal.');
    console.log('\nAdd this as the CWS_REFRESH_TOKEN secret on GitHub (it is shown only once, keep it private):\n');
    console.log(body.refresh_token);
  } else {
    res.end('Something went wrong, see the terminal.');
    console.error('No refresh token in the response:', body);
  }
  server.close();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}`;
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/chromewebstore',
  access_type: 'offline',
  prompt: 'consent',
}).toString();
console.log(`Open this link in your browser and allow access:\n\n${authUrl}\n`);
