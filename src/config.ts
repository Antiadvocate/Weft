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
  /** Append Qwen3's `/no_think` control token to the last user message.
   *
   *  DEFAULTS OFF, and it shipped defaulting on. The token is read by a chat template, not by the
   *  sampler, so a model whose template does not know it sees a stray line of text at the very end
   *  of the prompt — the most salient position there is. Two separate saves show what that costs:
   *  one turn opened with a literal `(no_think)` printed into the prose, and another ended a nine
   *  hundred word deliberation with "(no_think mode: direct output, no reasoning)" and then
   *  narrated its own compliance. Both are worse than the thinking the switch was meant to prevent,
   *  and thinking is stripped from the output anyway. Turn this on only for a model you know
   *  honors it. */
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
  /** THE CEILING ON A NARRATOR TURN, IN TOKENS.
   *
   *  The cloud path asks for 5000, which is a safety number: it costs nothing when unused, and no
   *  cloud model is short of room. On a local server both halves of that are false. One real
   *  session ran `CtxLimit: 15673/20480` with a 15,480-token prompt and max_tokens 5000 — prompt
   *  plus budget landing exactly on the context limit, with nothing to spare and no way for the
   *  prompt to grow. And a model that is looping will happily fill every token it is given, so an
   *  oversized budget converts a small failure into a long one.
   *
   *  A turn of prose is a few hundred words. This caps the ask without touching TURN ENDINGS, which
   *  is still the only thing deciding where a scene actually stops. Prose calls only — a bookkeeping
   *  diff is JSON and needs its own room. 0 = no cap. */
  max_output?: number;
}

/** Sampler values used when the endpoint config doesn't say. Modest on purpose: enough to break a
 *  repetition cycle, not enough to change the voice of the prose. */
export const LOCAL_SAMPLER_DEFAULTS = { loop_guard: 0.3, top_p: 0.9 };
/** ~900 words of prose. Generous for a turn, and a third of a 20k window handed back. */
export const LOCAL_MAX_OUTPUT_DEFAULT = 1200;

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

/* ── THE DIFFUSION MODEL ON YOUR OWN MACHINE ──────────────────────────────────────────────────
 *
 *  Same convention as the text endpoint above, one slot down: an `image_model` id prefixed
 *  `local/` routes to this server instead of OpenRouter. It is configured separately because it
 *  is a different program on a different port — ComfyUI on 8188 while KoboldCpp holds 5001 — and
 *  because either half is useful alone (local pictures with a cloud narrator is the common case).
 *
 *  The reason this exists at all: a picture per turn. At cloud prices that is a few cents a
 *  message, which is a real number over a campaign and the reason illustration has been a button
 *  you press rather than something the story just does. On your own GPU it is free, so it can be
 *  automatic. See src/lib/diffusion.ts. */
const LOCAL_IMAGE_STORAGE = "weft-local-image";

export interface LocalImageEndpoint {
  /** Base URL with no trailing slash. ComfyUI: http://127.0.0.1:8188 — A1111: http://127.0.0.1:7860 */
  url: string;
  /** comfy = graph submitted to /prompt (reference images possible). a1111 = one POST to
   *  /sdapi/v1/txt2img (AUTOMATIC1111, Forge, SD.Next — no reference images). */
  backend: "comfy" | "a1111";
  /** Optional bearer token, for a server behind a proxy that wants one. */
  key?: string;
  /** COMFYUI ONLY — the workflow, in API format (Workflow → Export (API)), with %tokens% where the
   *  per-run values go. Blank uses a built-in plain txt2img graph, which needs only `checkpoint`
   *  set and does not use reference images. See WORKFLOW_TOKENS in lib/diffusion.ts. */
  workflow?: string;
  /** Checkpoint filename as the server knows it. */
  checkpoint?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  /** Long edge of the generated image; orientation follows the caller. Blank = SDXL/Flux buckets
   *  (1216x832 landscape, 832x1216 portrait). */
  width?: number;
  height?: number;
  negative?: string;
  /** Give up after this long. A big model on a modest card can take a minute a picture. */
  timeout_s?: number;
  /** Longest edge kept when the image is stored in the save. A sampler hands back a multi-megabyte
   *  PNG; the save holds it inline, one per turn (see shrinkDataUrl). */
  store_max_px?: number;
  /** PROMPT DIALECT. `natural` writes sentences (Flux, SD3, and any T5-conditioned model read them
   *  properly); `tags` writes comma-separated clauses and keeps them short, which is what CLIP-only
   *  models — SD1.5, SDXL, Pony and its descendants — actually parse. */
  prompt_style?: "natural" | "tags";
  /** Hold the seed still for a scene, so the same place with the same people keeps its framing and
   *  palette while the action changes. Off = a fresh roll every turn (more variety, less
   *  continuity). Default on. */
  lock_seed?: boolean;
}

export const LOCAL_IMAGE_DEFAULTS = {
  steps: 25, cfg: 5, sampler: "euler", scheduler: "normal", timeout_s: 240, store_max_px: 1280,
} as const;

export function getLocalImage(): LocalImageEndpoint | null {
  try {
    const raw = localStorage.getItem(LOCAL_IMAGE_STORAGE);
    if (!raw) return null;
    const c = JSON.parse(raw) as LocalImageEndpoint;
    if (!c?.url) return null;
    return { ...c, backend: c.backend === "a1111" ? "a1111" : "comfy", url: c.url.replace(/\/+$/, "") };
  } catch { return null; }
}

export function setLocalImage(c: LocalImageEndpoint | null): void {
  try {
    if (c?.url) localStorage.setItem(LOCAL_IMAGE_STORAGE, JSON.stringify({ ...c, url: c.url.trim().replace(/\/+$/, "") }));
    else localStorage.removeItem(LOCAL_IMAGE_STORAGE);
  } catch { /* quota */ }
}

export function hasLocalImage(): boolean { return !!getLocalImage(); }
