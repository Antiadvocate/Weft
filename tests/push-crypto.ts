/* Smoke test: WEB PUSH ENCRYPTION, ROUND-TRIPPED.
 *
 * This is the one part of the relay that fails silently when it is wrong. A malformed ciphertext is
 * not rejected by anything you can see — the push service accepts the POST, returns 201, and the
 * phone simply never buzzes. There is no error to read and nothing in a log to find, so it has to
 * be checked here or not at all.
 *
 * So: build a subscriber the way a browser does (an ECDH keypair plus a 16-byte auth secret), seal
 * a payload to it with the relay's own code, then decrypt it the way a push service's client would
 * — deriving the same key from the OTHER side of the exchange — and check the plaintext comes back.
 * If the key schedule in relay/src/push.ts is off by one byte in any of the four HKDF info strings,
 * this fails.
 *
 * Also checks the VAPID assertion verifies against the public key it claims, since a bad signature
 * fails the same quiet way (401 from a service nobody is watching). */
import { encryptPush, vapidJwt, b64url, unb64url, concat } from "../relay/src/push";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, len * 8));
}

/** A subscription exactly as PushManager.subscribe() hands one over. */
async function makeSubscriber() {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    priv: kp.privateKey,
    pub,
    sub: {
      endpoint: "https://web.push.apple.com/QABC123",
      keys: { p256dh: b64url(pub), auth: b64url(auth) },
    },
  };
}

/** What the receiving end does: unpack the aes128gcm header, redo the exchange from its own side. */
async function openPush(body: Uint8Array, priv: CryptoKey, uaPub: Uint8Array, authSecret: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const ephPub = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);

  const ephKey = await crypto.subtle.importKey("raw", ephPub as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ephKey }, priv, 256));
  const prk = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPub, ephPub), 32);
  const cek = await hkdf(salt, prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, ct as BufferSource));
  return dec.decode(plain.slice(0, plain.length - 1));   // strip the 0x02 padding delimiter
}

/* ── the payload survives the round trip ─────────────────────────────────────── */
{
  const s = await makeSubscriber();
  const payload = { title: "Weaver", body: "The dal's from last night.", tag: "weaver-turn" };
  const { body, headers } = await encryptPush(s.sub, payload);

  let opened = "";
  let threw = "";
  try { opened = await openPush(body, s.priv, s.pub, unb64url(s.sub.keys.auth)); }
  catch (e) { threw = String((e as Error)?.message ?? e); }

  check("the ciphertext decrypts at the other end", !threw, threw);
  check("and the payload is exactly what went in", opened === JSON.stringify(payload), opened);
  check("the content-encoding says aes128gcm", headers["content-encoding"] === "aes128gcm", headers);
  check("a TTL is set, so a phone that is off still gets it later", Number(headers.ttl) > 0, headers.ttl);
}
{
  // the header layout is what an aes128gcm reader expects: salt(16) | rs(4) | idlen(1) | key
  const s = await makeSubscriber();
  const { body } = await encryptPush(s.sub, { a: 1 });
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  check("the record size is a sane 4096", rs === 4096, rs);
  check("the ephemeral key is a full uncompressed P-256 point", body[20] === 65, body[20]);
  check("which starts with the uncompressed marker", body[21] === 0x04, body[21]);
}
{
  // sealed to ONE subscriber: somebody else's key must not open it
  const a = await makeSubscriber();
  const b = await makeSubscriber();
  const { body } = await encryptPush(a.sub, { secret: "the shoe comes off once" });
  let opened = false;
  try { await openPush(body, b.priv, b.pub, unb64url(b.sub.keys.auth)); opened = true; } catch { /* expected */ }
  check("a different subscriber cannot open it", !opened);
}
{
  // a long payload spans more than one AES block and must still come back whole
  const s = await makeSubscriber();
  const payload = { title: "Weaver", body: "x".repeat(1200) };
  const { body } = await encryptPush(s.sub, payload);
  const opened = await openPush(body, s.priv, s.pub, unb64url(s.sub.keys.auth));
  check("a long notification survives too", opened === JSON.stringify(payload), opened.length);
}

/* ── the VAPID assertion verifies ────────────────────────────────────────────── */
{
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const v = { publicKey: b64url(raw), privateKey: jwk.d!, subject: "mailto:weaver@example.com" };

  const jwt = await vapidJwt("https://web.push.apple.com", v);
  const [h, c, sig] = jwt.split(".");
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey,
    unb64url(sig) as BufferSource, enc.encode(`${h}.${c}`) as BufferSource);

  check("the VAPID signature verifies against its own public key", ok);
  check("it is an ES256 JWT", JSON.parse(new TextDecoder().decode(unb64url(h))).alg === "ES256");
  const claims = JSON.parse(new TextDecoder().decode(unb64url(c)));
  check("scoped to the endpoint's origin, not the full URL", claims.aud === "https://web.push.apple.com", claims.aud);
  check("and it expires — an assertion good forever is a credential", claims.exp > Date.now() / 1000, claims.exp);
  check("under the 24h cap push services enforce", claims.exp < Date.now() / 1000 + 24 * 3600, claims.exp);
  check("with a subject the service can contact", /^mailto:/.test(claims.sub), claims.sub);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
