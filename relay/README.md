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
npx wrangler secret put RELAY_TOKEN        # any long random string you invent
npx wrangler secret put VAPID_PUBLIC       # from `npm run keys`
npx wrangler secret put VAPID_PRIVATE      # from `npm run keys`
npx wrangler secret put VAPID_SUBJECT      # mailto:you@example.com

npm run deploy
```

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
| `src/push.ts`  | RFC 8291 payload encryption + RFC 8292 VAPID, round-tripped by `tests/push-crypto.ts` |
| `keys.mjs`     | one-time VAPID keypair generation |
