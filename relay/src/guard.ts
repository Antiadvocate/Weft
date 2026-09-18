/** WHAT THE RELAY LETS THROUGH.
 *
 *  Three checks, kept apart from the worker because they are the answer to "is this input safe"
 *  and nothing else — no Durable Object, no fetch, no environment. That means `tests/relay-door.ts`
 *  can run them under plain Node, which is the only way any of this gets exercised: the routing in
 *  index.ts needs a Workers runtime, and a check nobody can run is a check nobody trusts.
 */

/** The 128-bit random `newJobId()` writes, in lowercase hex, and nothing else.
 *
 *  A job id is the read capability for a completion, so it has to BE a capability rather than a
 *  name. `DurableObjectNamespace.idFromName` does not look anything up — it MANUFACTURES an object
 *  for whatever string it is handed — so a route that passes the URL segment straight through will
 *  create a fresh Durable Object on the operator's paid account for every request in a for-loop. */
export const JOB_ID = /^[0-9a-f]{32}$/;

/** Push services a subscription may name.
 *
 *  The relay POSTs to the endpoint in a subscription carrying a VAPID assertion signed with the
 *  operator's private key, so an unchecked endpoint is a request forger pointed wherever the caller
 *  likes, leaving from Cloudflare's edge with that signature on it. These four are every push
 *  service a browser hands out today; add yours if you use another. */
export const PUSH_HOSTS = [
  "push.services.mozilla.com",
  "fcm.googleapis.com",
  "notify.windows.com",
  "push.apple.com",
];

/** Compare in time that does not depend on how much of the token is right.
 *
 *  A `===` on strings stops at the first wrong byte, which over enough requests is a way to read
 *  the secret out one character at a time rather than guessing all of it at once. The empty-string
 *  case matters as much as the timing: a relay deployed before `wrangler secret put RELAY_TOKEN`
 *  has an undefined token, and it must refuse everyone rather than admit everyone. */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A subscription's endpoint is a URL the relay will POST to. Accept https, and only the hosts
 *  above — matched as a whole host or a subdomain of one, so that neither `evilpush.apple.com` nor
 *  `fcm.googleapis.com.attacker.example` reads as the real thing. */
export function pushEndpointAllowed(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}
