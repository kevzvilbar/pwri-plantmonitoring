#!/usr/bin/env node
/**
 * Generates a VAPID keypair for Web Push (RFC 8292).
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Then set the values in BOTH places — they must be the same pair or every push
 * will be rejected by the push service with 401/403:
 *
 *   # Edge Function secret (the private key never leaves the server)
 *   supabase secrets set VAPID_PUBLIC_KEY="<publicKey>" \
 *                        VAPID_PRIVATE_KEY="<privateKey>" \
 *                        VAPID_SUBJECT="mailto:alerts@yourdomain.com"
 *
 *   # Frontend build-time var (public key is safe to ship; it is not a secret)
 *   VITE_VAPID_PUBLIC_KEY=<publicKey>   # frontend/.env.local + CI env
 *
 * ⚠️ Replacing an existing keypair invalidates every stored subscription: the
 * browser binds a subscription to the applicationServerKey it was created with,
 * so all users must re-enable push notifications after a rotation.
 */

import { webcrypto } from 'node:crypto';

const toBase64Url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const keyPair = await webcrypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' },
  true,
  ['deriveBits'],
);

// Uncompressed P-256 point: 0x04 || X(32) || Y(32) — 65 bytes, 87 base64url chars.
const publicKey = toBase64Url(new Uint8Array(await webcrypto.subtle.exportKey('raw', keyPair.publicKey)));

// 32-byte private scalar. Exported via JWK because 'raw' is not defined for EC
// private keys.
const jwk = await webcrypto.subtle.exportKey('jwk', keyPair.privateKey);
const privateKey = jwk.d;

// Fail loudly rather than emit a keypair that would be silently rejected later.
if (publicKey.length !== 87 || privateKey.length !== 43) {
  console.error(
    `Refusing to emit a malformed keypair: publicKey is ${publicKey.length} chars (expected 87), ` +
      `privateKey is ${privateKey.length} chars (expected 43).`,
  );
  process.exit(1);
}

console.log('# VAPID keypair — generated', new Date().toISOString());
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VITE_VAPID_PUBLIC_KEY=${publicKey}`);
console.log('');
console.log('# VAPID_SUBJECT should be a mailto: or https: contact URI you control,');
console.log('# e.g. mailto:alerts@yourdomain.com');
