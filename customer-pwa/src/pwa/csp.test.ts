import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the report-only policy matches the theme script and does not collect reports', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  const hash = createHash('sha256').update(script[1]).digest('base64');
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as {
    rewrites: { source: string; destination: string }[];
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  assert.equal(config.rewrites[0]?.destination.includes('motorcycle-delivery-production.up.railway.app'), true);
  assert.equal(config.rewrites.some((rule) => rule.destination === '/index.html'), true);
  const policy = config.headers.flatMap((group) => group.headers)
    .find((header) => header.key === 'Content-Security-Policy-Report-Only');
  assert.ok(policy);
  assert.equal(policy.value.includes(`'sha256-${hash}'`), true);
  assert.equal(policy.value.includes("script-src 'self'"), true);
  assert.equal(policy.value.includes("'unsafe-inline'"), true);
  assert.equal(policy.value.includes("script-src"), true);
  assert.equal(/script-src[^;]*unsafe-inline/.test(policy.value), false);
  assert.equal(policy.value.includes("frame-ancestors 'none'"), true);
  assert.equal(policy.value.includes("object-src 'none'"), true);
  assert.equal(policy.value.includes('https://maps.googleapis.com'), true);
  assert.equal(policy.value.includes('https://fonts.googleapis.com'), true);
  assert.equal(policy.value.includes('https://fonts.gstatic.com'), true);
  assert.equal(policy.value.includes('https://firebaseinstallations.googleapis.com'), true);
  assert.equal(policy.value.includes('https://fcmregistrations.googleapis.com'), true);
  assert.equal(policy.value.includes('https://fcm.googleapis.com'), true);
  assert.equal(policy.value.includes('www.gstatic.com/firebasejs'), false);
  assert.equal(policy.value.includes('blob:'), true);
  assert.equal(policy.value.includes('report-uri'), false);
  assert.equal(policy.value.includes('report-to'), false);
  assert.equal(JSON.stringify(config).includes('Reporting-Endpoints'), false);
});
