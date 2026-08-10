/** Generate a VAPID keypair. Run once: `npm run keys`, then paste the two values into
 *  `wrangler secret put VAPID_PUBLIC` / `VAPID_PRIVATE`, and the public one into Weaver's
 *  Settings so the browser can subscribe against the same identity. */
import { webcrypto as crypto } from "node:crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("raw", pair.publicKey);       // 65 bytes: 0x04 || X || Y
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log("VAPID_PUBLIC  =", b64url(pub));
console.log("VAPID_PRIVATE =", jwk.d);
console.log("\nPublic key also goes in Weaver → Settings → Background turns.");
