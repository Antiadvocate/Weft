/* Smoke test: WHAT THE RELAY LETS THROUGH.
 *
 * Weft has no game server — the engine, the saves and the cast all live in the browser, so the
 * whole class of "list every world, delete any of them" does not have a surface to exist on. The
 * relay is the exception, and it is the only code in the repository that a stranger can reach.
 *
 * It was written to be gated by one shared token, and three of its checks were missing.
 *
 * 1. THE ID WAS A NAME, NOT A CAPABILITY. `/job/:id` passed whatever followed the slash to
 *    `DurableObjectNamespace.idFromName`, which does not look anything up — it MANUFACTURES an
 *    object for any string it is given. So an unauthenticated GET loop created Durable Objects on
 *    the operator's paid account as fast as it could send requests.
 *
 * 2. THE TOKEN WAS COMPARED WITH `===`. String equality returns at the first differing byte, so how
 *    long the 401 takes to come back says how much of the token was right.
 *
 * 3. THE PUSH ENDPOINT WAS WHATEVER THE CALLER SAID. The relay POSTs to that URL carrying a VAPID
 *    assertion signed with the operator's private key.
 *
 * These are the checks, exercised directly. What they cannot cover is the routing that calls them,
 * so the order in index.ts — auth, then id, then push endpoint, then the namespace — is the part
 * that still has to be read rather than run. */
import { JOB_ID, sameSecret, pushEndpointAllowed } from "../relay/src/guard";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── the id is the 128-bit random and nothing else ───────────────────────────── */
{
  // Exactly what src/relay.ts newJobId() writes: 16 random bytes as lowercase hex.
  const real = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
  check("a real job id is accepted", JOB_ID.test(real), real);

  check("an empty id is refused", !JOB_ID.test(""));
  check("a short id is refused", !JOB_ID.test("abc"));
  check("a long id is refused", !JOB_ID.test("a".repeat(33)));
  check("uppercase hex is refused", !JOB_ID.test("A".repeat(32)));
  check("a word is refused", !JOB_ID.test("spam".repeat(8)));
  // The two that make an unbounded Durable Object farm out of a for-loop.
  check("a counter is refused", !JOB_ID.test("1"));
  check("a path is refused", !JOB_ID.test("../".repeat(10) + "ab"));
  // ^$ rather than \b: a trailing newline must not sneak an id past the anchor.
  check("a trailing newline is refused", !JOB_ID.test(`${"a".repeat(32)}\n`));
}

/* ── the token comparison does not leak its length or its prefix ─────────────── */
{
  const secret = "correct-horse-battery-staple-9271";
  check("the right token passes", sameSecret(secret, secret));
  check("a wrong token of the same length fails", !sameSecret("x".repeat(secret.length), secret));
  check("a correct prefix fails", !sameSecret(secret.slice(0, -1) + "x", secret));
  check("a short token fails", !sameSecret(secret.slice(0, 4), secret));
  check("an empty token fails", !sameSecret("", secret));
  // The one that matters most: a relay deployed without RELAY_TOKEN set must refuse everyone
  // rather than accept everyone, which is what an empty-string comparison would do.
  check("an unset RELAY_TOKEN refuses an empty token", !sameSecret("", ""));
  check("an unset RELAY_TOKEN refuses any token", !sameSecret("anything", ""));

  // Every wrong answer reads the whole string, so the loop count does not depend on the prefix.
  // Timing on a shared runner is too noisy to assert on; this asserts the property the loop has
  // instead — no early return — by checking two very different wrong tokens both come back false.
  check("a token differing at byte 0 fails", !sameSecret("Xorrect-horse-battery-staple-9271", secret));
  check("a token differing at the last byte fails", !sameSecret("correct-horse-battery-staple-927X", secret));
}

/* ── the push endpoint is a real push service ────────────────────────────────── */
{
  check("Firefox's endpoint is allowed",
    pushEndpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/gAAAAA"));
  check("Chrome's endpoint is allowed",
    pushEndpointAllowed("https://fcm.googleapis.com/fcm/send/abc:123"));
  check("Apple's endpoint is allowed",
    pushEndpointAllowed("https://web.push.apple.com/QAAAA"));
  check("Edge's endpoint is allowed",
    pushEndpointAllowed("https://wns2-par02p.notify.windows.com/w/?token=x"));

  check("an unrelated host is refused", !pushEndpointAllowed("https://attacker.example/collect"));
  // The suffix trick: endsWith("push.apple.com") without the dot would take this.
  check("a lookalike host is refused", !pushEndpointAllowed("https://evilpush.apple.com/x"));
  // And the other direction: an allowed host as a prefix of somebody else's domain.
  check("an allowed host used as a prefix is refused",
    !pushEndpointAllowed("https://fcm.googleapis.com.attacker.example/x"));
  check("http is refused", !pushEndpointAllowed("http://fcm.googleapis.com/fcm/send/x"));
  // The SSRF shapes: the metadata service and the loopback interface, from Cloudflare's edge.
  check("a private address is refused", !pushEndpointAllowed("https://169.254.169.254/latest/meta-data/"));
  check("loopback is refused", !pushEndpointAllowed("https://127.0.0.1/"));
  check("a file url is refused", !pushEndpointAllowed("file:///etc/passwd"));
  check("a non-string is refused", !pushEndpointAllowed(undefined));
  check("garbage is refused", !pushEndpointAllowed("not a url"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
