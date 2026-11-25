import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing release configuration: ' + name);
  return value;
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(new URL(url).pathname + ' returned HTTP ' + response.status);
  return response.json();
}

const publisher = encodeURIComponent(required('CWS_PUBLISHER_ID'));
const item = required('CWS_EXTENSION_ID');
if (!/^[a-p]{32}$/.test(item)) throw new Error('Invalid Chrome Web Store extension ID.');
const version = required('RELEASE_TAG').slice(1);
const token = await request('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'refresh_token', client_id: required('CWS_CLIENT_ID'),
    client_secret: required('CWS_CLIENT_SECRET'), refresh_token: required('CWS_REFRESH_TOKEN'),
  }),
});
if (!token.access_token) throw new Error('Google did not return an access token.');
const headers = { Authorization: 'Bearer ' + token.access_token };
const base = 'https://chromewebstore.googleapis.com';
const resource = '/v2/publishers/' + publisher + '/items/' + item;
const status = () => request(base + resource + ':fetchStatus', { headers });
const { publishedItemRevisionStatus, submittedItemRevisionStatus } = await status();
const existing = [publishedItemRevisionStatus, submittedItemRevisionStatus].find(revision =>
  revision?.distributionChannels?.some(channel => channel.crxVersion === version));

if (existing && ['PUBLISHED', 'PENDING_REVIEW'].includes(existing.state)) {
  console.log('Version %s is already %s.', version, existing.state);
} else {
  const upload = await request(base + '/upload' + resource + ':upload', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' },
    body: await readFile('Margin-Web-Store.zip'),
  });
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error('Unexpected uploaded version: ' + upload.crxVersion);
  let state = upload.uploadState;
  for (let attempt = 0; state === 'IN_PROGRESS' && attempt < 60; attempt++) {
    await delay(5000);
    state = (await status()).lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error('Store upload did not complete: ' + state);
  const submission = await request(base + resource + ':publish', { method: 'POST', headers });
  if (!['PENDING_REVIEW', 'PUBLISHED'].includes(submission.state)) throw new Error('Unexpected submission state: ' + submission.state);
  console.log('Version %s: %s.', version, submission.state);
}
