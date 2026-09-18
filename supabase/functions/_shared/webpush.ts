/**
 * Web Push delivery primitives.
 *
 * Implements the four RFCs a push endpoint actually requires:
 *   RFC 8030 — Generic Event Delivery Using HTTP Push (the POST + TTL/Topic/Urgency headers)
 *   RFC 8188 — Encrypted Content-Encoding for HTTP ("aes128gcm" record format)
 *   RFC 8291 — Message Encryption for Web Push (the ECDH + HKDF key schedule)
 *   RFC 8292 — VAPID (the signed `Authorization: vapid t=..., k=...` token)
 *
 * WHY THIS EXISTS
 * Before this module, send-push-notification POSTed the plaintext JSON straight
 * at the subscription endpoint with no Authorization header and no body
 * encryption. Every push service (FCM / Mozilla autopush / Apple / WNS) rejects
 * that, so `sent` was permanently 0 and no alert ever reached a device. A push
 * request is only valid when it carries BOTH:
 *   1. `Authorization: vapid t=<ES256 JWT>, k=<our public key>`  (RFC 8292)
 *   2. `Content-Encoding: aes128gcm` + a body encrypted to the subscriber's
 *      `p256dh`/`auth` keys                                  (RFC 8291 + 8188)
 *
 * Deliberately dependency-free: pure WebCrypto + fetch, both of which are
 * native in Deno (Supabase Edge Functions), Node 18+ and browsers. No npm
 * import, so nothing can break on a Node-compat shim inside the edge runtime.
 *
 * The key schedule is verified byte-for-byte against the RFC 8291 Appendix A
 * test vector — see webpush.test.ts. Do not "simplify" the HKDF calls or the
 * record header without re-running that test.
 */

const textEncoder = new TextEncoder();

// ── base64 / base64url codec ────────────────────────────────────────────────
// Self-contained on purpose: `atob`/`Buffer` are not uniformly present across
// Deno, Node and the browser, and this file has to run in all three.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64_ALPHABET.length; i += 1) B64_LOOKUP[B64_ALPHABET[i]] = i;

/**
 * Decodes standard base64 OR base64url, with or without padding. The client
 * stores `p256dh`/`auth` as standard base64 (from `btoa`), while VAPID keys are
 * conventionally base64url — accepting both avoids a whole class of "works on
 * my machine" key-format bugs.
 */
export function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((cleaned.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (const ch of cleaned) {
    const v = B64_LOOKUP[ch];
    if (v === undefined) throw new Error(`Invalid base64 character: ${ch}`);
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[idx] = (value >> bits) & 0xff;
      idx += 1;
    }
  }
  return out.subarray(0, idx);
}

/** Encodes to base64url WITHOUT padding (the JWS / VAPID convention). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 === undefined) break;
    out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 === undefined) break;
    out += B64_ALPHABET[b2 & 0x3f];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Single-block HKDF-SHA256 (RFC 5869). One subtle.deriveBits call performs
 * Extract-then-Expand, so `salt` is the extract salt and `info` the expand info.
 */
async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const P256_UNCOMPRESSED_BYTES = 65;
const AUTH_SECRET_BYTES = 16;
/** 4096 is the record size every push service accepts (and what the RFC uses). */
const RECORD_SIZE = 4096;

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' } as const;

// ── RFC 8291 §3.4 — content encryption ──────────────────────────────────────

/**
 * Deterministic inputs for the encryption step. Production callers omit this and
 * let fresh values be generated; the RFC test vector injects the published
 * `salt` + application-server keypair so the derivation below can be checked
 * byte-for-byte against Appendix A.
 */
export interface EncryptionContext {
  salt: Uint8Array;
  ephemeralKeyPair: CryptoKeyPair;
}

/**
 * Encrypts `plaintext` for a single subscriber per RFC 8291 §3.4, returning the
 * complete `aes128gcm` message body: `header || ciphertext`.
 *
 * Key schedule (the exact HKDF info strings are load-bearing):
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   PRK_key     = HKDF-Extract(salt=auth_secret, IKM=ecdh_secret)
 *   IKM         = HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_public || as_public, 32)
 *   PRK         = HKDF-Extract(salt=salt, IKM=IKM)
 *   CEK         = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16)
 *   NONCE       = HKDF-Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
 *
 * NOTE ON AAD: RFC 8188 §2.1 leaves the additional authenticated data empty for
 * this content coding. Passing the record header as AAD instead is a common and
 * silent mistake — it yields plausible-looking output whose GCM tag is wrong, so
 * every push service 400s. Confirmed against the RFC test vector; keep it empty.
 */
export async function encryptWebPushPayload(
  plaintext: Uint8Array,
  p256dh: Uint8Array,
  authSecret: Uint8Array,
  context?: Partial<EncryptionContext>,
): Promise<Uint8Array> {
  if (p256dh.length !== P256_UNCOMPRESSED_BYTES || p256dh[0] !== 0x04) {
    throw new Error(
      `p256dh must be a ${P256_UNCOMPRESSED_BYTES}-byte uncompressed P-256 point (got ${p256dh.length} bytes)`,
    );
  }
  if (authSecret.length !== AUTH_SECRET_BYTES) {
    throw new Error(`auth secret must be ${AUTH_SECRET_BYTES} bytes (got ${authSecret.length})`);
  }

  // Fresh ephemeral keypair + salt per message. Reusing either across messages
  // breaks confidentiality (see RFC 8188 §4.3 on key/nonce reuse) — which is why
  // production never supplies these and they are generated here.
  const ephemeral =
    context?.ephemeralKeyPair ??
    (await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveBits']));
  const salt = context?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const uaPublicKey = await crypto.subtle.importKey('raw', p256dh, ECDH_PARAMS, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaPublicKey },
      ephemeral.privateKey,
      256,
    ),
  );

  const keyInfo = concat(textEncoder.encode('WebPush: info\0'), p256dh, asPublic);
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32);
  const cek = await hkdf(ikm, salt, textEncoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, textEncoder.encode('Content-Encoding: nonce\0'), 12);

  // RFC 8188 §2.1 header: salt(16) || rs(uint32 BE) || idlen(1) || keyid
  const header = concat(
    salt,
    new Uint8Array([
      (RECORD_SIZE >>> 24) & 0xff,
      (RECORD_SIZE >>> 16) & 0xff,
      (RECORD_SIZE >>> 8) & 0xff,
      RECORD_SIZE & 0xff,
    ]),
    new Uint8Array([asPublic.length]),
    asPublic,
  );

  // Single-record message: payload followed by the 0x02 "final record" delimiter.
  const padded = concat(plaintext, new Uint8Array([0x02]));

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(0), tagLength: 128 },
      cekKey,
      padded,
    ),
  );

  return concat(header, ciphertext);
}

// ─ RFC 8292 — VAPID ────────────────────────────────────────────────────────

export interface VapidKeys {
  /** URL-safe base64, 65-byte uncompressed P-256 point. Safe to publish. */
  publicKey: string;
  /** URL-safe base64, 32-byte private scalar. NEVER expose to the client. */
  privateKey: string;
  /** `mailto:` or `https:` contact URI for the push service operator. */
  subject: string;
}

/** VAPID tokens are valid for at most 24h (RFC 8292 §2); 12h leaves ample slack. */
const VAPID_DEFAULT_TTL_SECONDS = 12 * 60 * 60;

/**
 * Builds the `Authorization` header value for one push endpoint.
 *
 * ⚠️ The `aud` claim MUST be the origin of the specific endpoint being pushed to
 * (RFC 8292 §2) — a token minted for one push service is rejected by another.
 * The signature is the raw 64-byte R||S form, which is what WebCrypto returns
 * for ECDSA and what JWS requires; converting it to DER would invalidate it.
 */
export async function createVapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  ttlSeconds: number = VAPID_DEFAULT_TTL_SECONDS,
): Promise<string> {
  const aud = new URL(endpoint).origin;

  const publicBytes = base64ToBytes(vapid.publicKey);
  if (publicBytes.length !== P256_UNCOMPRESSED_BYTES || publicBytes[0] !== 0x04) {
    throw new Error(
      `VAPID public key must be a ${P256_UNCOMPRESSED_BYTES}-byte uncompressed P-256 point (got ${publicBytes.length} bytes)`,
    );
  }
  const privateBytes = base64ToBytes(vapid.privateKey);
  if (privateBytes.length !== 32) {
    throw new Error(`VAPID private key must be a 32-byte scalar (got ${privateBytes.length} bytes)`);
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicBytes.subarray(1, 33)),
      y: bytesToBase64Url(publicBytes.subarray(33, 65)),
      d: bytesToBase64Url(privateBytes),
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = {
    aud,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: vapid.subject,
  };
  const payload = bytesToBase64Url(textEncoder.encode(JSON.stringify(claims)));

  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      textEncoder.encode(`${header}.${payload}`),
    ),
  );

  return `vapid t=${header}.${payload}.${bytesToBase64Url(signature)}, k=${vapid.publicKey}`;
}

/** `Topic` collapses pending messages with the same value (RFC 8030 §5.4): ≤32 URL-safe chars. */
function sanitizeTopic(topic: string): string {
  return topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

// ── RFC 8030 — delivery ─────────────────────────────────────────────────────

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendWebPushOptions {
  ttlSeconds?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** Optional collapse key; falls back to the payload's own tag. */
  topic?: string;
}

export interface WebPushSendResult {
  endpoint: string;
  ok: boolean;
  status: number;
  /** 404/410 means the subscription is gone and should be pruned. */
  expired: boolean;
  error?: string;
}

/**
 * Delivers one encrypted, VAPID-authenticated push message.
 *
 * Never throws: a single bad subscriber must not abort a fan-out to the rest,
 * so failures come back as `{ ok: false, error }` and the caller counts them.
 */
export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  payloadJson: string,
  vapid: VapidKeys,
  options: SendWebPushOptions = {},
): Promise<WebPushSendResult> {
  const endpoint = subscription.endpoint;
  try {
    const body = await encryptWebPushPayload(
      textEncoder.encode(payloadJson),
      base64ToBytes(subscription.p256dh),
      base64ToBytes(subscription.auth),
    );

    const headers: Record<string, string> = {
      Authorization: await createVapidAuthorization(endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttlSeconds ?? 86400),
    };
    if (options.urgency) headers['Urgency'] = options.urgency;
    // sanitizeTopic can strip a tag down to nothing; never emit an empty Topic.
    const topic = options.topic ? sanitizeTopic(options.topic) : '';
    if (topic) headers['Topic'] = topic;

    // Content-Length is intentionally omitted — fetch computes it from the body.
    const res = await fetch(endpoint, { method: 'POST', headers, body });
    return {
      endpoint,
      ok: res.ok,
      status: res.status,
      expired: res.status === 404 || res.status === 410,
    };
  } catch (err) {
    return {
      endpoint,
      ok: false,
      status: 0,
      expired: false,
      error: (err as Error)?.message ?? 'unknown error',
    };
  }
}
