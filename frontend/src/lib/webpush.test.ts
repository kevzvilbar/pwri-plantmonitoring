/**
 * Verifies the SHIPPED Web Push crypto in
 * `supabase/functions/_shared/webpush.ts` against the RFC 8291 Appendix A test
 * vector, and checks the RFC 8292 VAPID token and RFC 8030 request headers.
 *
 * WHY THE TEST LIVES HERE (and not next to the module):
 * This repo's only wired-up runner is vitest, and Deno is not installed on the
 * build machines. Importing the real module is deliberate — duplicating the
 * algorithm into a test would let production drift out of spec while the suite
 * still went green, which is exactly the bug this file exists to prevent.
 *
 * NOTE: jsdom 20 does not implement `crypto.subtle`, so Node's WebCrypto is
 * installed for this file. It is the same ECDH / HKDF / AES-GCM / ECDSA surface
 * the Deno edge runtime exposes, so the vector match remains meaningful.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import {
  base64ToBytes,
  bytesToBase64Url,
  encryptWebPushPayload,
  createVapidAuthorization,
  sendWebPush,
  type VapidKeys,
} from '../../../supabase/functions/_shared/webpush';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const ECDH_P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Decode with Node's base64url (independent of the module under test). */
const raw = (s: string) => new Uint8Array(Buffer.from(s.replace(/\s+/g, ''), 'base64url'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// ── RFC 8291 §5 / Appendix A test vector ────────────────────────────────────
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  // header || ciphertext, 144 octets — "the result shown in Section 5"
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg' +
    'Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

const toJwk = (uncompressedPublic: Uint8Array, privateScalar?: Uint8Array) => ({
  kty: 'EC',
  crv: 'P-256',
  x: Buffer.from(uncompressedPublic.slice(1, 33)).toString('base64url'),
  y: Buffer.from(uncompressedPublic.slice(33, 65)).toString('base64url'),
  ...(privateScalar ? { d: Buffer.from(privateScalar).toString('base64url') } : {}),
  ext: true,
});

/** Builds a CryptoKeyPair for the RFC's fixed application-server key. */
async function rfcApplicationServerKeyPair(): Promise<CryptoKeyPair> {
  const pub = raw(RFC.asPublic);
  return {
    privateKey: await crypto.subtle.importKey(
      'jwk', toJwk(pub, raw(RFC.asPrivate)), ECDH_P256, false, ['deriveBits'],
    ),
    publicKey: await crypto.subtle.importKey('jwk', toJwk(pub), ECDH_P256, true, []),
  };
}

/**
 * Receiver-side decryption, implemented from the RFC independently of the
 * module: parse the header out of the message, re-derive the key material from
 * the *subscriber's* private key, and recover the plaintext.
 */
async function decryptAsSubscriber(
  message: Uint8Array,
  subscriberPrivateKey: CryptoKey,
  subscriberPublicKey: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  const salt = message.slice(0, 16);
  const idlen = message[20];
  const keyid = message.slice(21, 21 + idlen);
  const ciphertext = message.slice(21 + idlen);

  const hkdf = async (ikm: Uint8Array, hsalt: Uint8Array, info: Uint8Array, len: number) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: hsalt, info }, key, len * 8,
    ));
  };
  const concat = (...cs: Uint8Array[]) => {
    const out = new Uint8Array(cs.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of cs) { out.set(c, o); o += c.length; }
    return out;
  };

  const asPublicKey = await crypto.subtle.importKey('raw', keyid, ECDH_P256, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: asPublicKey }, subscriberPrivateKey, 256,
  ));

  const ikm = await hkdf(
    ecdhSecret, authSecret,
    concat(new TextEncoder().encode('WebPush: info\0'), subscriberPublicKey, keyid), 32,
  );
  const cek = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array(0), tagLength: 128 },
    cekKey, ciphertext,
  ));
  // Strip the single-record padding delimiter (0x02) mandated by RFC 8188 §2.
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x00) end -= 1;
  expect(padded[end - 1]).toBe(0x02);
  return new TextDecoder().decode(padded.slice(0, end - 1));
}

describe('webpush (RFC 8291 encryption)', () => {
  it('reproduces the RFC 8291 Appendix A message body byte-for-byte', async () => {
    const message = await encryptWebPushPayload(
      raw(RFC.plaintext),
      raw(RFC.uaPublic),
      raw(RFC.authSecret),
      { salt: raw(RFC.salt), ephemeralKeyPair: await rfcApplicationServerKeyPair() },
    );
    // Any deviation in the HKDF info strings, the salt, the AAD, or the record
    // header changes these bytes.
    expect(hex(message)).toBe(hex(raw(RFC.body)));
  });

  it('lays out the RFC 8188 header as salt | rs | idlen | keyid', async () => {
    const message = await encryptWebPushPayload(
      raw(RFC.plaintext), raw(RFC.uaPublic), raw(RFC.authSecret),
      { salt: raw(RFC.salt), ephemeralKeyPair: await rfcApplicationServerKeyPair() },
    );

    expect(message.length).toBe(86 + raw(RFC.ciphertext).length);
    expect(hex(message.slice(0, 16))).toBe(hex(raw(RFC.salt)));         // salt
    expect(Array.from(message.slice(16, 20))).toEqual([0, 0, 0x10, 0]); // rs = 4096, big-endian
    expect(message[20]).toBe(65);                                       // idlen
    expect(hex(message.slice(21, 86))).toBe(hex(raw(RFC.asPublic)));    // keyid = our public key
    expect(hex(message.slice(86))).toBe(hex(raw(RFC.ciphertext)));
  });

  it('produces a message a subscriber can actually decrypt (random keys)', async () => {
    const subscriber = await crypto.subtle.generateKey(ECDH_P256, true, ['deriveBits']);
    const subscriberPublic = new Uint8Array(
      await crypto.subtle.exportKey('raw', subscriber.publicKey),
    );
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = JSON.stringify({ title: 'RO Train 3 Offline', body: 'Train 3 tripped at 04:12.' });

    const message = await encryptWebPushPayload(
      new TextEncoder().encode(plaintext), subscriberPublic, authSecret,
    );

    await expect(
      decryptAsSubscriber(message, subscriber.privateKey, subscriberPublic, authSecret),
    ).resolves.toBe(plaintext);
  });

  it('uses a fresh salt and ephemeral key per message', async () => {
    const p256dh = raw(RFC.uaPublic);
    const auth = raw(RFC.authSecret);
    const a = await encryptWebPushPayload(new TextEncoder().encode('x'), p256dh, auth);
    const b = await encryptWebPushPayload(new TextEncoder().encode('x'), p256dh, auth);
    expect(hex(a.slice(0, 16))).not.toBe(hex(b.slice(0, 16)));
    expect(hex(a.slice(21, 86))).not.toBe(hex(b.slice(21, 86)));
  });

  it('rejects malformed subscription keys instead of silently sending junk', async () => {
    const auth = raw(RFC.authSecret);
    await expect(
      encryptWebPushPayload(new TextEncoder().encode('x'), new Uint8Array(32), auth),
    ).rejects.toThrow(/uncompressed P-256 point/);

    await expect(
      encryptWebPushPayload(new TextEncoder().encode('x'), raw(RFC.uaPublic), new Uint8Array(8)),
    ).rejects.toThrow(/auth secret must be 16 bytes/);
  });
});

/** Generates a real VAPID keypair (public point + private scalar) for the tests. */
async function generateVapidKeys(subject = 'mailto:ops@pwri.example'): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey(ECDH_P256, true, ['deriveBits']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {
    publicKey: bytesToBase64Url(
      new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
    ),
    privateKey: jwk.d as string,
    subject,
  };
}

const claimsOf = (authorization: string) => {
  const jwt = authorization.replace('vapid t=', '').split(', k=')[0];
  const [header, payload] = jwt.split('.');
  return {
    jwt,
    header,
    payload,
    json: JSON.parse(Buffer.from(payload, 'base64url').toString()),
  };
};

describe('webpush (RFC 8292 VAPID)', () => {
  it('mints an ES256 token that verifies against the advertised public key', async () => {
    const vapid = await generateVapidKeys();
    const authorization = await createVapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc123', vapid,
    );

    expect(authorization.startsWith('vapid t=')).toBe(true);
    expect(authorization.split(', k=')[1]).toBe(vapid.publicKey);

    const { jwt, header, payload, json } = claimsOf(authorization);
    expect(JSON.parse(Buffer.from(header, 'base64url').toString()))
      .toEqual({ typ: 'JWT', alg: 'ES256' });

    // aud MUST be the endpoint's origin, never the full path (RFC 8292 §2).
    expect(json.aud).toBe('https://fcm.googleapis.com');
    expect(json.sub).toBe(vapid.subject);

    const now = Math.floor(Date.now() / 1000);
    expect(json.exp).toBeGreaterThan(now);
    expect(json.exp).toBeLessThanOrEqual(now + 24 * 60 * 60); // hard RFC ceiling

    // JWS needs the raw 64-byte R||S signature; a DER-encoded one would fail here.
    const signature = raw(jwt.split('.')[2]);
    expect(signature.length).toBe(64);
    const publicKey = await crypto.subtle.importKey(
      'jwk', toJwk(raw(vapid.publicKey)), ECDSA_P256, false, ['verify'],
    );
    await expect(
      crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        signature,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true);
  });

  it('scopes aud to each individual push service', async () => {
    const vapid = await generateVapidKeys();
    const fcm = claimsOf(await createVapidAuthorization('https://fcm.googleapis.com/a', vapid));
    const mozilla = claimsOf(
      await createVapidAuthorization('https://updates.push.services.mozilla.com/b', vapid),
    );
    expect(fcm.json.aud).toBe('https://fcm.googleapis.com');
    expect(mozilla.json.aud).toBe('https://updates.push.services.mozilla.com');
  });

  it('rejects a malformed VAPID key pair', async () => {
    await expect(
      createVapidAuthorization('https://fcm.googleapis.com/a', {
        publicKey: 'AAAA', privateKey: 'AAAA', subject: 'mailto:a@b.c',
      }),
    ).rejects.toThrow(/VAPID public key/);
  });
});

describe('webpush (RFC 8030 delivery)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    p256dh: RFC.uaPublic,
    auth: RFC.authSecret,
  };

  it('sends every header a push service requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendWebPush(
      subscription,
      JSON.stringify({ title: 'RO Train 3 Offline', body: 'Went offline at 04:12.' }),
      await generateVapidKeys(),
      { urgency: 'high', topic: 'train-offline-3' },
    );

    expect(result).toMatchObject({ ok: true, status: 201, expired: false });

    const init = fetchMock.mock.calls[0][1];
    // The two headers whose absence made every previous send fail:
    expect(init.headers.Authorization).toMatch(/^vapid t=/);
    expect(init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(init.headers.TTL).toBe('86400');
    expect(init.headers.Urgency).toBe('high');
    expect(init.headers.Topic).toBe('train-offline-3');
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(init.body.length).toBeGreaterThan(86); // header + encrypted payload
  });

  it('flags 404/410 subscriptions for pruning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 410 }));
    const result = await sendWebPush(subscription, '{}', await generateVapidKeys());
    expect(result).toMatchObject({ ok: false, status: 410, expired: true });
  });

  it('reports a transport error instead of throwing mid fan-out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await sendWebPush(subscription, '{}', await generateVapidKeys());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('never emits an empty Topic', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);
    await sendWebPush(subscription, '{}', await generateVapidKeys(), { topic: '!!!' });
    expect(fetchMock.mock.calls[0][1].headers.Topic).toBeUndefined();
  });
});
