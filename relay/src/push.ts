/** WEB PUSH — RFC 8291 (aes128gcm payload encryption) and RFC 8292 (VAPID).
 *
 *  Written against WebCrypto directly: Workers has no node crypto, and pulling a library in for
 *  four primitives is more moving parts than the four primitives. Kept in its own file with no
 *  Workers types and no network calls so it can be round-tripped in a test — this is the one part
 *  of the relay that fails SILENTLY when it is wrong. A bad ciphertext is not rejected by anything
 *  you can see; the push service accepts the POST and the phone simply never buzzes.
 *
 *  See tests/push-crypto.ts, which decrypts what this produces using the subscriber's private key
 *  and checks the plaintext comes back. */

export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Vapid { publicKey: string; privateKey: string; subject: string }

const enc = new TextEncoder();

export const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const b = new Uint8Array(buf as ArrayBuffer);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
export const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, len * 8);
  return new Uint8Array(bits);
}

/** The encrypted body and the headers that describe it. Everything but the VAPID authorization,
 *  which depends on the endpoint's origin and is added by the caller. */
export async function encryptPush(sub: PushSub, payload: unknown): Promise<{ body: Uint8Array; headers: Record<string, string> }> {
  const plain = enc.encode(JSON.stringify(payload));
  const uaPublic = unb64url(sub.keys.p256dh);
  const authSecret = unb64url(sub.keys.auth);

  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // `as any` on the algorithm: Workers' generated types name the peer key `$public` where the DOM
  // (and every runtime, including Workers itself) uses `public`. This file has to compile against
  // workers-types AND run under node in the round-trip test, so the cast is the honest way through.
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as any, eph.privateKey, 256));

  // RFC 8291 §3.3: the pseudo-random key binds both public keys, so a ciphertext is only
  // decryptable by the subscriber it was sealed for.
  const prk = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, ephPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  // 0x02 is the padding delimiter marking the final record — a single record here.
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource }, aes, concat(plain, new Uint8Array([2])) as BufferSource));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return {
    body: concat(salt, rs, new Uint8Array([ephPub.length]), ephPub, ct),
    headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "normal" },
  };
}

/** The VAPID assertion: proof to the push service that this is the same party the browser
 *  subscribed against, scoped to one endpoint origin and valid for twelve hours. */
export async function vapidJwt(audience: string, v: Vapid): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: v.subject || "mailto:weaver@example.com",
  })));
  const pub = unb64url(v.publicKey);     // 65 bytes, uncompressed: 0x04 || X || Y
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256",
    d: v.privateKey,
    x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`) as BufferSource);
  return `${head}.${claims}.${b64url(sig)}`;
}

/** Authorization header value for a push POST. */
export async function vapidHeader(endpoint: string, v: Vapid): Promise<string> {
  const jwt = await vapidJwt(new URL(endpoint).origin, v);
  return `vapid t=${jwt}, k=${v.publicKey}`;
}
