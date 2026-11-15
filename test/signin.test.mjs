import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyGoogleToken } from '../functions/_lib/signin.js';

const b64u = b => Buffer.from(b).toString('base64url');
async function token(key, kid, claims) {
  const h = b64u(JSON.stringify({ alg: 'RS256', kid })), p = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + p));
  return h + '.' + p + '.' + b64u(new Uint8Array(sig));
}

test('accepts a real Google token and rejects forged, foreign and expired ones', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256' };
  const keys = async () => ({ keys: [jwk] });
  const ok = { iss: 'https://accounts.google.com', aud: 'my-client', exp: Math.floor(Date.now() / 1000) + 600, email: 'Parent@Example.com', email_verified: true, name: 'A Parent' };
  assert.deepEqual(await verifyGoogleToken(await token(pair.privateKey, 'k1', ok), 'my-client', keys), { email: 'parent@example.com', name: 'A Parent' });
  await assert.rejects(verifyGoogleToken(await token(other.privateKey, 'k1', ok), 'my-client', keys));
  await assert.rejects(verifyGoogleToken(await token(pair.privateKey, 'k1', { ...ok, aud: 'someone-else' }), 'my-client', keys));
  await assert.rejects(verifyGoogleToken(await token(pair.privateKey, 'k1', { ...ok, exp: 1 }), 'my-client', keys));
  await assert.rejects(verifyGoogleToken(await token(pair.privateKey, 'k1', { ...ok, email_verified: false }), 'my-client', keys));
});
