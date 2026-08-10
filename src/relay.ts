/** THE RELAY, FROM THE BROWSER'S SIDE.
 *
 *  When a relay is configured, the narrator call is made by the relay instead of by this tab, and
 *  this tab merely watches. That is the whole difference, and it is the difference between a turn
 *  that dies when iOS kills the app and a turn that is sitting there finished when you come back.
 *
 *  ONLY THE NARRATOR GOES THROUGH IT. Not the bookkeeper, not the forge, not the reads. Two
 *  reasons. The narrator call is the long one — a minute against ten seconds — so it is the one the
 *  kill lands in. And the bookkeeper is the pass that would require shipping the save: it returns a
 *  diff against world state, and the moment a server is applying diffs it is a game server holding
 *  your story. It is not worth that. On return the finished prose is waiting and only the short
 *  bookkeeping pass runs, which is why a resumed turn takes seconds rather than starting over.
 *
 *  With no relay configured every one of these functions no-ops and the app behaves exactly as it
 *  did before. That property is load-bearing: Weaver is a static site you can run from a file with
 *  nothing but an API key, and adding a server must never become a requirement for playing. */

export interface RelayConfig {
  url: string;          // https://weaver-relay.<you>.workers.dev
  token: string;        // RELAY_TOKEN, so the job endpoint is not open to the world
  vapid?: string;       // VAPID_PUBLIC, if push is wanted
}

const KEY = "weft:relay";

export function getRelay(): RelayConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as RelayConfig;
    return c?.url && c?.token ? { ...c, url: c.url.replace(/\/+$/, "") } : null;
  } catch { return null; }
}
export function setRelay(c: RelayConfig | null): void {
  try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch { /* quota */ }
}

/** A job id, generated before the request is made and journaled with the turn. It is what lets a
 *  cold-booted app find the completion it already paid for — so it must exist BEFORE the call, and
 *  it must never be regenerated on a retry. */
export function newJobId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function relayHealth(c: RelayConfig): Promise<{ ok: boolean; vapid?: string | null; error?: string }> {
  try {
    const res = await fetch(`${c.url}/health`);
    if (!res.ok) return { ok: false, error: `relay returned ${res.status}` };
    return { ok: true, ...(await res.json()) };
  } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e) }; }
}

/** Hand the request over. Returns as soon as the relay has taken it — the model call outlives this
 *  fetch, this tab, and the app process. */
export async function startJob(c: RelayConfig, id: string, body: unknown, push?: PushJSON | null): Promise<void> {
  const res = await fetch(`${c.url}/job`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ id, body, push: push ?? undefined }),
  });
  if (!res.ok) throw new Error(`relay ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** What the relay has for this job right now. The cold-boot path: no streaming, no waiting, just
 *  "is it done and what is it". */
export interface JobState { status: "running" | "done" | "error"; text: string; error?: string; usage?: RawUsage | null; truncated?: boolean }
export interface RawUsage { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } }

export async function fetchJob(c: RelayConfig, id: string): Promise<JobState> {
  const res = await fetch(`${c.url}/job/${id}`);
  if (!res.ok) throw new Error(`relay ${res.status}`);
  return res.json();
}

/** Live tokens while the player is actually watching.
 *
 *  Deliberately fetch + ReadableStream rather than EventSource: EventSource cannot be aborted by an
 *  AbortSignal, and the stop button has to keep working. Losing this reader does not stop the job —
 *  that is the point — so cancelling detaches the view and leaves the completion to be collected or
 *  discarded later. */
export async function* streamJob(c: RelayConfig, id: string, signal?: AbortSignal): AsyncGenerator<string, { usage?: RawUsage | null; truncated?: boolean }, unknown> {
  const res = await fetch(`${c.url}/job/${id}/sse`, { signal });
  if (!res.ok || !res.body) throw new Error(`relay stream ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return {};
    buf += dec.decode(value, { stream: true });
    const records = buf.split("\n\n");
    buf = records.pop() ?? "";
    for (const rec of records) {
      const line = rec.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: { delta?: string; done?: boolean; error?: string; usage?: RawUsage | null; truncated?: boolean };
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev.error) throw new Error(ev.error);
      if (ev.done) return { usage: ev.usage, truncated: ev.truncated };
      if (ev.delta) yield ev.delta;
    }
  }
}

/* ── PUSH ───────────────────────────────────────────────────────────────────────────────────────
 * On iOS this works ONLY in a web app added to the home screen — an open Safari tab has no
 * PushManager at all — and the permission prompt must come from something the player tapped. Both
 * constraints are Apple's, and both are why the button lives in Settings rather than firing on
 * load. */

export interface PushJSON { endpoint: string; keys: { p256dh: string; auth: string } }

export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** True when running as an installed home-screen app rather than a browser tab — the thing iOS
 *  requires before it will hand over a subscription. */
export function isInstalled(): boolean {
  return typeof window !== "undefined" &&
    (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true);
}

export async function subscribePush(vapidPublic: string): Promise<PushJSON> {
  if (!pushSupported()) throw new Error("this browser has no push support");
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: unb64(vapidPublic),
  });
  return sub.toJSON() as PushJSON;
}

export async function currentPush(): Promise<PushJSON | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? (sub.toJSON() as PushJSON) : null;
  } catch { return null; }
}

export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch { /* already gone */ }
}

/** base64url → bytes, on a plain ArrayBuffer. The explicit buffer matters: applicationServerKey is
 *  typed BufferSource, and a Uint8Array whose backing store TypeScript believes might be shared
 *  does not satisfy it. */
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
