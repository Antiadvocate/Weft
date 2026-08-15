/** Browser-side config. The OpenRouter key lives in localStorage on THIS device only. */
const KEY_STORAGE = "weft-openrouter-key";

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}
export function setApiKey(k: string): void {
  if (k) localStorage.setItem(KEY_STORAGE, k.trim());
  else localStorage.removeItem(KEY_STORAGE);
}
export function hasApiKey(): boolean {
  return !!getApiKey();
}

/* ── THE MODEL ON YOUR OWN MACHINE ────────────────────────────────────────────────────────────
 *
 *  KoboldCpp, llama.cpp's server, LM Studio, Ollama and text-generation-webui all speak the same
 *  OpenAI-shaped /chat/completions, so "run it locally" needs no new client — it needs a different
 *  base URL and a way to say which calls go there.
 *
 *  THE CONVENTION: a model id prefixed `local/` routes to this endpoint; everything else goes to
 *  OpenRouter exactly as before. It rides on top of the four model slots the engine already has,
 *  so any single role can be local while the rest stay in the cloud — the useful configuration
 *  being a local narrator (the long, expensive, creative call) with a cloud bookkeeper (the short
 *  one that must emit strict JSON, which is the thing small models are worst at).
 *
 *  Nothing here is required. With no endpoint configured, no `local/` id can be selected and the
 *  app behaves precisely as it did before. */
const LOCAL_STORAGE = "weft-local-endpoint";

/** The id prefix that means "not OpenRouter — my machine". */
export const LOCAL_PREFIX = "local/";

export interface LocalEndpoint {
  /** OpenAI-compatible base, INCLUDING the version segment: http://localhost:5001/v1 */
  url: string;
  /** Optional. Most local servers ignore it; LM Studio and some proxies want something. */
  key?: string;
  /** Qwen3 and other hybrid-reasoning GGUFs think out loud by default, and those tokens are both
   *  slow and visible. Append the `/no_think` control token to the last user message. */
  no_think?: boolean;
  /* ── SAMPLER ──────────────────────────────────────────────────────────────────────────────────
   *  OpenRouter's providers ship sane sampler defaults; a local server hands you whatever its own
   *  defaults are, and with a heavily quantized model those defaults produce the classic failure —
   *  one clause repeating until the token budget runs out. A real save looped on "a fisherman's
   *  boat drifts sideways" three times and then hit the cap.
   *
   *  Only fields in the OpenAI standard are sent, because all four supported servers accept those
   *  and llama.cpp's rejects some unknown ones outright. 0 means "don't send it" — the server's own
   *  default wins, which is the escape hatch for anyone who tunes sampling on their own side. */
  /** frequency_penalty. The direct counter to verbatim looping. */
  loop_guard?: number;
  /** top_p. */
  top_p?: number;
}

/** Sampler values used when the endpoint config doesn't say. Modest on purpose: enough to break a
 *  repetition cycle, not enough to change the voice of the prose. */
export const LOCAL_SAMPLER_DEFAULTS = { loop_guard: 0.3, top_p: 0.9 };

export function getLocalEndpoint(): LocalEndpoint | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE);
    if (!raw) return null;
    const c = JSON.parse(raw) as LocalEndpoint;
    if (!c?.url) return null;
    return { ...c, url: c.url.replace(/\/+$/, "") };
  } catch { return null; }
}

export function setLocalEndpoint(c: LocalEndpoint | null): void {
  try {
    if (c?.url) localStorage.setItem(LOCAL_STORAGE, JSON.stringify({ ...c, url: c.url.trim().replace(/\/+$/, "") }));
    else localStorage.removeItem(LOCAL_STORAGE);
  } catch { /* quota */ }
}

export function hasLocalEndpoint(): boolean { return !!getLocalEndpoint(); }

/** Does this model id name the machine under the desk? */
export function isLocalModel(id: string): boolean {
  return !!id && id.startsWith(LOCAL_PREFIX);
}

/** The id as the local server knows it. KoboldCpp serves whatever single GGUF it loaded and
 *  ignores this entirely; llama-server and LM Studio use it to pick among loaded models. */
export function localModelId(id: string): string {
  return isLocalModel(id) ? id.slice(LOCAL_PREFIX.length) || "default" : id;
}
