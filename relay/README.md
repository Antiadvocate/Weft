# Weaver relay

Somewhere for the waiting to happen.

## What problem this solves

A web app added to the iOS home screen is not *suspended* when you leave it — it is **terminated**,
within seconds. The narrator call takes about a minute. So the ordinary shape of play (type a turn,
look at something else, come back) kills the request every time, and you return to a cold boot with
the turn gone.

Nothing running on the phone can fix that; there is no process left to run it in. The fix is to make
the request from somewhere that isn't the phone.

With a relay configured: you send a turn, leave, get a notification, come back, and the prose is
waiting. Bookkeeping then takes a few seconds and the turn is done.

## What it is not

Not a game server. It never sees your save, never applies a diff, never holds story state between
calls. It takes one model request, makes it, keeps the answer until you collect it, and forgets.
The engine stays entirely in your browser.

**What it does see**, stated plainly: the narrator prompt — which contains the world digest and the
recent prose — and the completion that comes back. That is the same material your API key already
carries to OpenRouter, but it is now also passing through a service *you* run, so deploy it to your
own Cloudflare account and nobody else's.

Only the narrator goes through it. The bookkeeper is the pass that would require shipping the save,
so it stays on the device.

## Cost

This needs the **Workers Paid plan, $5/month**. The free plan caps CPU at 10 ms per request, and
while waiting on the model does not count toward that, decoding and accumulating a few thousand
tokens of stream does — a long turn will blow through 10 ms and die with a 1102. Durable Objects
also want a paid plan.

Model tokens are billed to your OpenRouter key exactly as before; the relay changes where the call
is made from, not what it costs.

## Setup

```sh
cd relay
npm install
npx wrangler login

# one-time: generate the notification signing pair
npm run keys

# secrets (none of these live in wrangler.toml)
npx wrangler secret put OPENROUTER_KEY     # your OpenRouter key
npx wrangler secret put RELAY_TOKEN        # 32+ random characters — see below
npx wrangler secret put VAPID_PUBLIC       # from `npm run keys`
npx wrangler secret put VAPID_PRIVATE      # from `npm run keys`
npx wrangler secret put VAPID_SUBJECT      # mailto:you@example.com

# optional: the one web origin allowed to call this relay
npx wrangler secret put ALLOWED_ORIGIN     # https://yourname.github.io

npm run deploy
```

**Generate `RELAY_TOKEN`, do not invent it.** It is the only thing between a stranger and your
OpenRouter balance, and a token somebody thought up is a token somebody can think up:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## What the relay refuses

Everything but `/health` wants `Authorization: Bearer $RELAY_TOKEN`, reads included. Weft sends it
on every call; there is no query-string form, because a token in a URL is a token in Cloudflare's
request logs and in the browser's history.

Four other things are checked, and each one is there because of what it costs when it is not:

| check | what it stops |
|---|---|
| the token is compared byte-for-byte to the end | a `===` returns at the first wrong character, and how fast the 401 comes back says how much of the token was right |
| a job id must be 32 lowercase hex characters | `idFromName` does not look an object up, it makes one — so a URL segment passed straight through turns a `for` loop into an unbounded Durable Object bill on your account |
| a push endpoint must be https and a real push service | the relay POSTs there with a VAPID assertion signed by your private key; unchecked, that is a request forger leaving Cloudflare's edge with your signature on it |
| a request body over 1 MB is refused | a narrator prompt is a few hundred kilobytes; the rest is somebody's afternoon |

`ALLOWED_ORIGIN` is optional and worth setting. It names the one web origin whose pages a browser
will let read the relay's answers — your Pages URL, `https://yourname.github.io`. Unset, any origin
can read them, and a stranger with your token can drive the relay from a page of their own.

None of this makes a leaked `RELAY_TOKEN` survivable. If you paste it somewhere public, run
`wrangler secret put RELAY_TOKEN` with a new one and re-enter it in Tuning.

Then in Weaver → Settings → **Background turns**:

1. Paste the deployed URL (`https://weaver-relay.<you>.workers.dev`) and your `RELAY_TOKEN`.
2. **Save & test.** It fetches `/health`, and fills in the VAPID public key for you.
3. **Turn on notifications.** This only works from the home-screen app — iOS gives a plain Safari
   tab no access to `PushManager` at all. Share → Add to Home Screen, open it from the icon, then
   press the button.

Clearing the URL turns the relay off; turns go back to running in the tab.

## If something is wrong

- **"couldn't reach it"** — the URL is wrong, or the deploy failed. `curl https://…/health` should
  return `{"ok":true,...}`.
- **Turns work but no notification** — you are in a browser tab rather than the installed app, or
  permission was denied. iOS gives no second prompt: delete the home-screen icon, re-add it, and try
  again.
- **`1102 Worker exceeded CPU`** — you are on the free plan. See Cost above.
- **Notifications stop after a while** — push subscriptions expire. Press the button again.

The relay is optional and failure is soft: if it is unreachable when a turn starts, Weaver logs a
warning and makes the call directly, exactly as it did before. You lose the background behaviour for
that turn, never the turn.

## Layout

| file | |
|---|---|
| `src/index.ts` | routing, and the Durable Object that outlives the request |
| `src/guard.ts` | the three input checks, kept runnable under plain Node by `tests/relay-door.ts` |
| `src/push.ts`  | RFC 8291 payload encryption + RFC 8292 VAPID, round-tripped by `tests/push-crypto.ts` |
| `keys.mjs`     | one-time VAPID keypair generation |
