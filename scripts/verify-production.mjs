// Read-only release verification: stream downloads, never execute installers.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const base = 'https://life-os-tdl.vercel.app';
const downloads = {
  'LifeOS.apk': '9f4945e166b4bb3336ca66b6f739caa3c171170a80a2da752ca53561fa673044',
  'LifeOS-Setup.exe': '77946cb62f6ab6b88d450cbdcf1926dc3687175b196f1f2a86c05e968528ae3a',
  'LifeOS-Portable.exe': '4ccad4b6fd9593ccf0a38c598062ddeb17b07fe5e1844136d53ec0f87a6d6bfa',
};
for (const [file, expected] of Object.entries(downloads)) {
  const response = await fetch(`${base}/${file}`, { signal: AbortSignal.timeout(180_000) });
  assert.equal(response.status, 200, file);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.length; }
  const digest = hash.digest('hex');
  assert.equal(digest, expected, `${file} must match tested local package`);
  console.log(`${file}: 200, ${bytes} bytes, SHA256 ${digest} MATCH`);
}
const text = async (path) => {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, path);
  return response.text();
};
const html = await text('/app');
const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
assert.ok(entry, 'production entry script');
const js = await text(entry[1]);
const app = js.match(/AppRoot-[A-Za-z0-9_-]+\.js/);
assert.ok(app, 'production app chunk');
const code = await text(`/assets/${app[0]}`);
for (const marker of ['Enable wake mode', 'Loading offline speech model', 'add_subtask', 'complete_reminder']) {
  assert.ok(code.includes(marker), `deployed app includes ${marker}`);
}
console.log(`Production web release verified: ${app[0]}`);
