/* Smoke test: THE POLICY ON THE PAGE.
 *
 * Weft keeps an OpenRouter key in localStorage, which is the right place for it — there is no
 * server to hold it instead — and it makes exactly one thing worth preventing: a script that is not
 * Weft's, running on Weft's origin. `script-src 'self'` is what refuses that, and it only works
 * while the build emits no inline script, because the day it does somebody will add 'unsafe-inline'
 * to fix the blank page and the directive will have been quietly turned off.
 *
 * So this checks the policy is present and still says what it was written to say, and it checks the
 * page it sits on has no inline script for anyone to need an exception for.
 *
 * `connect-src *` is deliberate and is asserted as deliberate. The model endpoint is whatever the
 * player typed — openrouter.ai, their own relay worker, or localhost:5001 with KoboldCpp behind it
 * — so there is no host list to write. A CSP that cannot stop exfiltration can still stop the
 * injected script that would do the exfiltrating, and that is the trade being made here. */
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
/** Comments are not markup, and the note above the policy talks about script tags by name. */
const markup = html.replace(/<!--[\s\S]*?-->/g, "");

const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
check("the page carries a Content-Security-Policy", !!meta);

const policy = meta?.[1] ?? "";
const directive = (name: string): string => {
  const d = policy.split(";").map((x) => x.trim()).find((x) => x === name || x.startsWith(`${name} `));
  return d ? d.slice(name.length).trim() : "";
};

/* ── the directive the key depends on ────────────────────────────────────────── */
{
  check("script-src is 'self' alone", directive("script-src") === "'self'", directive("script-src"));
  check("script-src does not allow inline", !/unsafe-inline/.test(directive("script-src")));
  check("script-src does not allow eval", !/unsafe-eval/.test(directive("script-src")));
  const inline = [...markup.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim());
  check("there is no inline <script> to need an exception for", inline.length === 0, inline.map((m) => m[1].trim().slice(0, 60)));
}

/* ── the directive that stops a save file phoning home ───────────────────────── */
{
  const img = directive("img-src");
  check("img-src allows data: (every picture Weft makes)", /\bdata:/.test(img), img);
  check("img-src allows blob:", /\bblob:/.test(img), img);
  check("img-src allows no remote host", !/https?:/.test(img) && !/\*/.test(img), img);
}

/* ── and the two cheap tricks that survive a strict script-src ───────────────── */
{
  check("base-uri is 'none'", directive("base-uri") === "'none'", directive("base-uri"));
  check("object-src is 'none'", directive("object-src") === "'none'", directive("object-src"));
  check("form-action is 'none'", directive("form-action") === "'none'", directive("form-action"));
  check("default-src is 'self'", directive("default-src") === "'self'", directive("default-src"));
}

/* ── the fonts the page actually loads are still allowed ─────────────────────── */
{
  check("the Google Fonts stylesheet is allowed", /fonts\.googleapis\.com/.test(directive("style-src")));
  check("the font files are allowed", /fonts\.gstatic\.com/.test(directive("font-src")));
  // Tailwind and motion both write style at runtime; this exception is for them and only them.
  check("style-src allows inline, which is what motion needs", /unsafe-inline/.test(directive("style-src")));
}

/* ── connect-src is open, and that is the decision ───────────────────────────── */
{
  check("connect-src is open, because the endpoint is whatever the player typed",
    directive("connect-src") === "*", directive("connect-src"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
