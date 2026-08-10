/**
 * WEAVER RELAY — somewhere for the waiting to happen.
 *
 * The problem this solves is specific. An iOS web app added to the home screen is not suspended
 * when you leave it, it is TERMINATED, within seconds. The narrator call takes a minute. So the
 * common shape of play — type a turn, switch to something else, come back — kills the request
 * every time, and the app comes back to a cold boot with the turn gone.
 *
 * Nothing running on the phone can fix that; there is no process left to run it in. The fix is to
 * make the request from somewhere that isn't the phone.
 *
 * WHAT THIS IS NOT: it is not a game server. It never sees your save, never applies a diff, never
 * holds any story state between calls. It takes one model request, makes it, keeps the answer until
 * you come back for it, and forgets. The engine stays entirely in the browser.
 *
 * WHAT IT DOES SEE, stated plainly: the narrator prompt, which contains the world digest and the
 * recent prose, and the completion that comes back. That is the same material your API key already
 * carries to the model provider — but it is now also passing through a service you deployed, so
 * deploy it to your own Cloudflare account and nobody else's.
 *
 * ── shape ──────────────────────────────────────────────────────────────────────────────────────
 *   POST /job          { id, body, push? }   → starts the call, returns immediately
 *   GET  /job/:id      → { status, text, error }        the cold-boot pickup
 *   GET  /job/:id/sse  → text/event-stream               live tokens while you are watching
 *   POST /push/test    { push }              → sends a notification, to check the plumbing
 *
 * One Durable Object per job: a Worker invocation cannot outlive its response, and the whole point
 * is to outlive the client. The DO holds the in-flight call and the accumulating text, and survives
 * the client going away mid-stream — which is the entire feature.
 */
import { encryptPush, vapidHeader, type PushSub } from "./push";

export interface Env {
  JOB: DurableObjectNamespace;
  /** Your OpenRouter key, set with: wrangler secret put OPENROUTER_KEY */
  OPENROUTER_KEY: string;
  /** Web push signing pair. See relay/README.md for generating them. */
  VAPID_PUBLIC: string;
  VAPID_PRIVATE: string;
  VAPID_SUBJECT: string;
  /** Shared secret so the job endpoint is not an open relay billed to you. */
  RELAY_TOKEN: string;
}

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...CORS } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] === "health") return json({ ok: true, vapid: env.VAPID_PUBLIC ?? null });

    // The token gates everything that can spend money or send a notification. Reads of a job you
    // already know the id of are open: the id is a 128-bit random, and requiring the header on the
    // SSE read would mean the browser could not use EventSource.
    const authed = () => {
      const h = req.headers.get("authorization") ?? "";
      const q = url.searchParams.get("t") ?? "";
      return !!env.RELAY_TOKEN && (h === `Bearer ${env.RELAY_TOKEN}` || q === env.RELAY_TOKEN);
    };

    if (parts[0] === "job" && req.method === "POST") {
      if (!authed()) return json({ error: "unauthorized" }, 401);
      const payload = await req.json<{ id?: string; body?: unknown; push?: PushSub }>().catch(() => null);
      if (!payload?.id || !payload.body) return json({ error: "id and body required" }, 400);
      const stub = env.JOB.get(env.JOB.idFromName(payload.id));
      return stub.fetch(new Request("https://do/start", { method: "POST", body: JSON.stringify(payload) }));
    }

    if (parts[0] === "job" && parts[1]) {
      const stub = env.JOB.get(env.JOB.idFromName(parts[1]));
      const path = parts[2] === "sse" ? "https://do/sse" : "https://do/state";
      return stub.fetch(new Request(path));
    }

    if (parts[0] === "push" && parts[1] === "test" && req.method === "POST") {
      if (!authed()) return json({ error: "unauthorized" }, 401);
      const { push } = await req.json<{ push: PushSub }>();
      try {
        await sendPush(push, { title: "Weaver", body: "Notifications are working." }, env);
        return json({ ok: true });
      } catch (e) { return json({ error: String(e) }, 500); }
    }

    return json({ error: "not found" }, 404);
  },
};

type Status = "running" | "done" | "error";

/** ONE JOB. Lives past the request that started it — that is the whole reason this class exists. */
export class Job {
  private state: DurableObjectState;
  private env: Env;
  private text = "";
  private status: Status = "running";
  private error = "";
  private started = false;
  /** Usage and the truncation flag ride back with the text: the client's cost governor and its
   *  footer-recovery both depend on them, and a relayed turn that reports neither would quietly
   *  blind the daily budget. */
  private usage: unknown = null;
  private truncated = false;
  /** Readers currently attached for live tokens. A reader going away is normal and not an error:
   *  it means the player backgrounded the app, which is the case this was built for. */
  private readers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Rehydrate after eviction. The DO can be evicted between the client dying and the client
    // coming back, so the answer has to be on disk, not only in memory.
    state.blockConcurrencyWhile(async () => {
      this.text = (await state.storage.get<string>("text")) ?? "";
      this.status = (await state.storage.get<Status>("status")) ?? "running";
      this.error = (await state.storage.get<string>("error")) ?? "";
      this.started = (await state.storage.get<boolean>("started")) ?? false;
      this.usage = (await state.storage.get("usage")) ?? null;
      this.truncated = (await state.storage.get<boolean>("truncated")) ?? false;
    });
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;

    if (path === "/start") {
      const { id, body, push } = await req.json<{ id: string; body: unknown; push?: PushSub }>();
      // Idempotent: a client that retried, or came back and re-posted, must not buy the completion
      // twice. The id is generated once per turn and journaled before the first attempt.
      if (this.started) return json({ id, status: this.status, resumed: true });
      this.started = true;
      await this.state.storage.put("started", true);
      if (push) await this.state.storage.put("push", push);
      // waitUntil, not await: the response goes back now and the call keeps running without it.
      this.state.waitUntil(this.run(body));
      return json({ id, status: "running" });
    }

    if (path === "/state") return json({ status: this.status, text: this.text, error: this.error, usage: this.usage, truncated: this.truncated });

    if (path === "/sse") {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const w = writable.getWriter();
      // Everything that already landed goes out first, so a reader attaching late — or
      // re-attaching after the app was killed — sees the whole completion, not just the tail.
      void (async () => {
        try {
          if (this.text) await w.write(sse({ delta: this.text }));
          if (this.status === "done") { await w.write(sse({ done: true, usage: this.usage, truncated: this.truncated })); await w.close(); return; }
          if (this.status === "error") { await w.write(sse({ error: this.error })); await w.close(); return; }
          this.readers.add(w);
        } catch { /* reader vanished before we finished catching it up */ }
      })();
      return new Response(readable, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...CORS },
      });
    }

    return json({ error: "not found" }, 404);
  }

  /** Make the call, accumulate, notify. The only long-lived thing in the system. */
  private async run(body: unknown): Promise<void> {
    try {
      const res = await fetch(OR_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.OPENROUTER_KEY}`,
          "content-type": "application/json",
          "x-title": "Weaver",
        },
        body: JSON.stringify({ ...(body as object), stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 300)}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sinceFlush = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // OpenRouter speaks SSE; split on the record separator and keep the remainder.
        const records = buf.split("\n\n");
        buf = records.pop() ?? "";
        for (const rec of records) {
          for (const line of rec.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let delta = "";
            try {
              const j = JSON.parse(data);
              delta = j?.choices?.[0]?.delta?.content ?? "";
              if (j?.usage) this.usage = j.usage;
              if (j?.choices?.[0]?.finish_reason === "length") this.truncated = true;
            } catch { continue; }
            if (!delta) continue;
            this.text += delta;
            sinceFlush += delta.length;
            await this.broadcast(sse({ delta }));
          }
        }
        // Persist periodically rather than per token — storage writes are the expensive part, and
        // losing the last couple of hundred characters to an eviction is survivable where losing
        // the whole completion is not.
        if (sinceFlush >= 2000) { sinceFlush = 0; await this.state.storage.put("text", this.text); }
      }
      if (!this.text) throw new Error("empty completion");
      this.status = "done";
      await this.state.storage.put({ text: this.text, status: "done", usage: this.usage, truncated: this.truncated });
      await this.broadcast(sse({ done: true, usage: this.usage, truncated: this.truncated }));
      await this.notify();
    } catch (e) {
      this.status = "error";
      this.error = String((e as Error)?.message ?? e);
      await this.state.storage.put({ status: "error", error: this.error, text: this.text });
      await this.broadcast(sse({ error: this.error }));
      await this.notify();
    } finally {
      for (const w of this.readers) { try { await w.close(); } catch { /* gone */ } }
      this.readers.clear();
      // The answer is worth keeping only until the client comes back for it. A day is generous.
      await this.state.storage.setAlarm(Date.now() + 24 * 3600e3);
    }
  }

  async alarm(): Promise<void> { await this.state.storage.deleteAll(); }

  private async broadcast(chunk: Uint8Array): Promise<void> {
    for (const w of [...this.readers]) {
      try { await w.write(chunk); }
      catch { this.readers.delete(w); }   // the player put the phone down; carry on
    }
  }

  private async notify(): Promise<void> {
    const push = await this.state.storage.get<PushSub>("push");
    if (!push) return;
    const payload = this.status === "done"
      ? { title: "Weaver", body: firstLine(this.text), tag: "weaver-turn" }
      : { title: "Weaver", body: "That turn failed — open to see why.", tag: "weaver-turn" };
    try { await sendPush(push, payload, this.env); } catch { /* a missed notification is not a lost turn */ }
  }
}

const enc = new TextEncoder();
const sse = (v: unknown): Uint8Array => enc.encode(`data: ${JSON.stringify(v)}\n\n`);

/** The notification body: enough of the prose to know what happened, without spoiling the read. */
function firstLine(text: string): string {
  const t = text.replace(/<<<SCENE[\s\S]*$/, "").trim();
  const line = (t.match(/^[\s\S]{0,140}?[.!?]["”]?/) ?? [t.slice(0, 140)])[0].trim();
  return line || "Your turn is ready.";
}

/** POST the sealed payload to the subscriber's push service. All the crypto lives in ./push.ts,
 *  which is round-tripped in tests/push-crypto.ts — see the note there about why this particular
 *  code cannot be verified by watching it work. */
async function sendPush(sub: PushSub, payload: unknown, env: Env): Promise<void> {
  const { body, headers } = await encryptPush(sub, payload);
  const authorization = await vapidHeader(sub.endpoint, {
    publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE, subject: env.VAPID_SUBJECT,
  });
  const res = await fetch(sub.endpoint, { method: "POST", headers: { ...headers, authorization }, body });
  if (!res.ok) throw new Error(`push ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
