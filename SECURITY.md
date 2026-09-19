# Security

## The short version

The failure being described in that Reddit thread — list every world on the server, read any of
them, delete all 228 — needs a server holding everyone's worlds. Weft does not have one. There is no
account, no database, no API, and no `/worlds` to enumerate. The engine is JavaScript that runs in
your tab; your saves are rows in your own browser's IndexedDB; your OpenRouter key is a string in
your own `localStorage`. A deployment of Weft is a folder of static files on GitHub Pages, and the
only thing a stranger can do to it is read the same JavaScript you did.

That removes the whole class of bug, and it does it by not having the component. What it does not
remove is everything else, so here is what is actually left.

## What a stranger can reach

**The page.** Static files. They hold no secret — the key is entered by whoever opens it, on their
own device. Two people playing on the same deployed URL share nothing at all: not saves, not
history, not a key, not a bill.

**The relay, if you deployed one.** This is the only server in the project, it is optional, and it
is yours: you deploy it to your own Cloudflare account with your own OpenRouter key in it. It exists
because iOS terminates a home-screen web app within seconds of being backgrounded, and the narrator
call takes a minute, so the call has to be made from somewhere that is not the phone. It takes one
model request, makes it, holds the answer for a day, and forgets. It never sees a save and never
applies a diff — the bookkeeping pass, the one that would need your world state, deliberately stays
on the device.

Everything on it but `/health` requires `Authorization: Bearer $RELAY_TOKEN`, reads included. See
[relay/README.md](relay/README.md) for the four other checks and why each is there. The token is the
whole door: generate it, do not invent it, and if it leaks, `wrangler secret put RELAY_TOKEN` a new
one.

**Your model provider.** The narrator prompt carries your world digest and your recent prose to
OpenRouter, or to the relay and then to OpenRouter, or to whatever local server you pointed a
`local/` model at. That is the same material your key already carried before any of this. A `local/`
endpoint is handed its own optional key and never the OpenRouter one.

## What we defend against, and how

**A script that is not Weft's, running on Weft's origin.** This is the one that would matter,
because it would read the key out of `localStorage`. The app renders every string — narrator prose,
character names, anything out of a save file — through React, which escapes; there is no
`dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, and no `new Function` anywhere in the source
or in the built bundle. On top of that `index.html` carries a Content-Security-Policy whose
`script-src` is `'self'` and nothing else, with no inline script in the build for anyone to need an
exception for. `tests/csp.ts` holds that.

`connect-src` is open, and that is a decision rather than an oversight: the model endpoint is
whatever the player typed, which may be `openrouter.ai`, their own relay subdomain, or
`localhost:5001` with KoboldCpp behind it, and a policy cannot name a host it has not been told
about. A CSP that cannot stop exfiltration can still stop the injected script that would do the
exfiltrating.

**A save file somebody sent you.** Worlds are meant to be traded, so the import path is the one
place where a stranger writes the bytes. Two things are taken off a file on the way in
(`scrubImported` in `src/lib/api.ts`, covered by `tests/imported-save.ts`):

- **Image URLs that are not `data:`.** Every picture Weft makes is a data URL. A save file can carry
  `https://somewhere-i-own/1.png` in `portrait_url` instead, and then the Cast screen fetches it on
  open — which tells the sender your IP address, your rough location, your browser and the hour you
  played their world, every time. That is a read receipt inside a gift. The URL is dropped on
  import, and `img-src 'self' data: blob:` refuses it at the browser as well.
- **`__proto__`, `constructor`, `prototype` as keys.** They survive `JSON.parse` as ordinary data
  and become an edit to every object in the program the moment something assigns them with `=`.
  Weft generates its own character ids and has no deep merge, so no route from a save file to a
  polluted prototype is known — but "no known route" across fifty thousand lines is a claim with a
  shelf life. The same three keys are refused in the raw editor's patch paths.

**The model's output.** Narration and the bookkeeper's diff are treated as text and structured data,
never as code. A diff is applied field by field through typed handlers, and character ids are minted
locally rather than taken from anything a model wrote.

## What we do not defend against

**Someone with your device, unlocked.** Your saves and your key are in your browser profile. Full
disk encryption and a screen lock are the control here, and they are not ours to provide.

**A browser extension.** An extension with access to the page can read `localStorage`. So can one on
any site you sign into.

**Your own OpenRouter bill, if you hand out your relay token.** The relay gates spending on that one
secret. Anyone holding it can spend your balance.

**A save file's contents as fiction.** Nothing in an imported world is treated as instruction to the
app, but the text in it does reach a model as part of a prompt. A world written to steer a narrator
will steer that narrator. That is a story problem, not a memory-safety one, and the repair for it is
the same as for any other bad turn: roll it back.

## Reporting something

Open an issue at <https://github.com/Antiadvocate/weft/issues>. If it is the kind of thing that
should not be a public issue first, say only that much in the issue and leave the detail out of it.

Weft has no hosted deployment, no shared database, and nobody else's worlds to lose — so there is no
service to take offline while a fix lands. A finding here is a patch and a `git pull`, and the
people running it update by redeploying their own Pages build.
