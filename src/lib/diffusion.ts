/**
 * THE DIFFUSION MODEL ON YOUR OWN MACHINE.
 *
 * Portraits and scene illustrations have always gone to OpenRouter, where an image is a few cents
 * and every one of them is a network round trip you pay for. That is fine for the handful of
 * portraits a cast needs. It is not fine for the thing this module exists to allow: a picture of
 * the scene REGENERATED EVERY TURN, which at cloud prices is a per-message tax and at local prices
 * is free.
 *
 * THE CONVENTION IS THE ONE config.ts ALREADY SET for text: an image model id prefixed `local/`
 * routes here; anything else goes to OpenRouter exactly as before. The image slot is independent
 * of the four text slots, so a local narrator with cloud images (or the reverse) is just two
 * settings, and with nothing configured the app behaves precisely as it did.
 *
 * TWO BACKENDS, because those are the two APIs every local image stack speaks:
 *   - ComfyUI     — a graph is submitted to /prompt and polled out of /history. Maximum control:
 *                   whatever workflow you can build in the UI, this can run, including the
 *                   reference-image nodes that make a character look like themselves.
 *   - A1111/Forge — one POST to /sdapi/v1/txt2img with a prompt and a seed. No graph, no setup,
 *                   no reference images. The five-minute option.
 *
 * WHAT MAKES THE SAME PERSON COME BACK (see also prompts.ts, `visualSignature`):
 *   1. A LOCKED DESCRIPTOR. The exact words that produced the portrait are stored on the character
 *      and reused verbatim in every scene. Diffusion models are far more prompt-literal than the
 *      multimodal LLMs the cloud path uses — the same clause really does return roughly the same
 *      face, and a clause that drifts word by word returns a different person every turn.
 *   2. A LOCKED SEED per character and per scene, so framing and palette hold still while the
 *      action changes.
 *   3. THE PORTRAIT ITSELF, as a reference image. Kontext, IP-Adapter, PuLID and InstantID all
 *      take one — and since they take ONE, several portraits are stitched into a single reference
 *      sheet here (buildReferenceSheet) rather than demanding a workflow that accepts four.
 *
 * NOTHING LEAVES THE MACHINE. Every request in this file goes to the URL you typed.
 */
import { getLocalImage, type LocalImageEndpoint } from "../config";

/** What a generation asks for. `refs` are data URLs — character portraits, already filtered by the
 *  caller for body-plan match (a person-shaped reference outvotes any amount of prompt text). */
export interface DiffusionRequest {
  prompt: string;
  negative?: string;
  seed?: number;
  aspect?: "portrait" | "landscape" | "square";
  refs?: string[];
  /** Checkpoint for THIS call, from the `local/<checkpoint>` id in the image slot. Overrides the
   *  one configured on the endpoint; `default`/blank means "whatever the settings or the workflow
   *  already say", which is what a KoboldCpp-style "one model is loaded" setup wants. */
  checkpoint?: string;
  /** Progress line for the UI ("queued", "step 12/30", "decoding"). */
  onProgress?: (note: string) => void;
  signal?: AbortSignal;
}

export interface DiffusionResult { url: string; seed: number; took_ms: number }

/* ── SIZES ───────────────────────────────────────────────────────────────────────────────────
 * SDXL and Flux are both trained around a megapixel; asking for 512x512 from an SDXL checkpoint
 * produces the melted-face look people blame on the prompt. These are the standard buckets. */
const SIZES = {
  portrait: { w: 832, h: 1216 },
  landscape: { w: 1216, h: 832 },
  square: { w: 1024, h: 1024 },
} as const;

/** The default negative. Text and watermarks are the two things every scene prompt used to have to
 *  ask AGAINST in the positive prompt, where asking for a thing by name is half a vote for it. */
export const DEFAULT_NEGATIVE =
  "text, watermark, signature, caption, letters, logo, ui, frame, border, split panel, collage, " +
  "extra limbs, extra fingers, deformed hands, mutated, disfigured, blurry, lowres, jpeg artifacts";

/** The model id in the image slot wins over the one typed into settings — it is the more specific
 *  of the two, and it is the one visible next to the picture being made. */
function pickCheckpoint(ep: LocalImageEndpoint, req: DiffusionRequest): string {
  const fromId = (req.checkpoint ?? "").trim();
  return fromId && fromId !== "default" ? fromId : (ep.checkpoint ?? "").trim();
}

function sizeFor(ep: LocalImageEndpoint, aspect: DiffusionRequest["aspect"]): { w: number; h: number } {
  const base = SIZES[aspect ?? "landscape"];
  if (!ep.width || !ep.height) return base;
  // a configured size is authoritative for the long edge; the orientation still follows the caller
  const long = Math.max(ep.width, ep.height), short = Math.min(ep.width, ep.height);
  if (aspect === "square") return { w: long, h: long };
  return aspect === "portrait" ? { w: short, h: long } : { w: long, h: short };
}

/** A stable 32-bit seed from any string. Same scene, same cast, same seed — which is what keeps a
 *  place looking like itself from one message to the next instead of being re-imagined each turn. */
export function seedFrom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h | 0) % 2147483647;
}

/* ── IMAGE PLUMBING ──────────────────────────────────────────────────────────────────────────── */

/** Bytes to a data URL WITHOUT FileReader — the conversion is three lines either way, and this one
 *  also runs anywhere the tests do. Chunked, because String.fromCharCode(...bytes) on a megabyte of
 *  PNG is a stack overflow. */
async function blobToDataUrl(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${b.type || "image/png"};base64,${btoa(bin)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("could not decode image"));
    img.src = src;
  });
}

/** RE-ENCODE SO A CAMPAIGN STILL FITS IN INDEXEDDB.
 *
 *  A local sampler hands back a full-size PNG — 2 to 4 MB is ordinary. The save holds these inline
 *  as data URLs, and store.ts already documents what a tens-of-megabytes save does to the main
 *  thread. One picture a turn would reach that in an afternoon. A 1280px JPEG of the same frame is
 *  ~200 KB and indistinguishable at the size it is displayed. */
export async function shrinkDataUrl(url: string, maxDim = 1280, quality = 0.85): Promise<string> {
  if (!url.startsWith("data:")) return url;
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    // already small AND already compressed — leave it alone
    if (scale >= 1 && url.length < 400_000) return url;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return url;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL("image/jpeg", quality);
    return out.length < url.length ? out : url;
  } catch { return url; }
}

/** ONE REFERENCE IMAGE OUT OF SEVERAL PORTRAITS.
 *
 *  Every reference mechanism worth using — Kontext, IP-Adapter, PuLID — takes a single image. A
 *  scene has a cast. Stitching the portraits into one strip means the ordinary single-image
 *  workflow carries the whole cast, and it is also simply how a human would hand the job over:
 *  here are the people, now draw them doing this. */
export async function buildReferenceSheet(refs: string[], tile = 512): Promise<string | null> {
  const usable = refs.filter((r) => r?.startsWith("data:")).slice(0, 4);
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  try {
    const imgs = await Promise.all(usable.map(loadImage));
    const c = document.createElement("canvas");
    c.width = tile * imgs.length; c.height = tile;
    const ctx = c.getContext("2d");
    if (!ctx) return usable[0];
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    imgs.forEach((img, i) => {
      const s = Math.min(tile / img.width, tile / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, i * tile + (tile - w) / 2, (tile - h) / 2, w, h);
    });
    return c.toDataURL("image/jpeg", 0.9);
  } catch { return usable[0]; }
}

function dataUrlToBlob(url: string): Blob {
  const [head, b64] = url.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/* ── COMFYUI ─────────────────────────────────────────────────────────────────────────────────── */

/** THE DEFAULT GRAPH — a plain txt2img, built here so the feature works with nothing pasted.
 *
 *  Core nodes only: it runs on any SD1.5/SDXL/Flux-fp8 checkpoint ComfyUI can load with
 *  CheckpointLoaderSimple. It does NOT do reference images — that needs nodes whose availability
 *  depends on what you have installed, which is exactly what the pasted-workflow path is for
 *  (KONTEXT_WORKFLOW below is a ready one). */
function defaultWorkflow(): string {
  return JSON.stringify({
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "%checkpoint%" } },
    "2": { class_type: "CLIPTextEncode", inputs: { text: "%prompt%", clip: ["1", 1] } },
    "3": { class_type: "CLIPTextEncode", inputs: { text: "%negative%", clip: ["1", 1] } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: "%width%", height: "%height%", batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        seed: "%seed%", steps: "%steps%", cfg: "%cfg%", sampler_name: "%sampler%", scheduler: "%scheduler%",
        denoise: 1, model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
      },
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    "7": { class_type: "SaveImage", inputs: { filename_prefix: "weft", images: ["6", 0] } },
  }, null, 2);
}

/** A READY REFERENCE WORKFLOW — FLUX.1 KONTEXT.
 *
 *  This is the one that answers "make it the same person as the portrait". Kontext takes an image
 *  as conditioning and edits/extends from it, so the cast sheet goes in and the people come out
 *  recognisable. Offered as a template to paste and adjust (the checkpoint name is the one thing
 *  that must match your install) rather than as a default, because it needs a Kontext model on
 *  disk and a recent ComfyUI for ReferenceLatent. */
export const KONTEXT_WORKFLOW = JSON.stringify({
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "flux1-dev-kontext_fp8_scaled.safetensors" } },
  "2": { class_type: "LoadImage", inputs: { image: "%ref1%", upload: "image" } },
  "3": { class_type: "FluxKontextImageScale", inputs: { image: ["2", 0] } },
  "4": { class_type: "VAEEncode", inputs: { pixels: ["3", 0], vae: ["1", 2] } },
  "5": { class_type: "CLIPTextEncode", inputs: { text: "%prompt%", clip: ["1", 1] } },
  "6": { class_type: "ReferenceLatent", inputs: { conditioning: ["5", 0], latent: ["4", 0] } },
  "7": { class_type: "FluxGuidance", inputs: { conditioning: ["6", 0], guidance: 2.5 } },
  "8": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["5", 0] } },
  "9": { class_type: "EmptyLatentImage", inputs: { width: "%width%", height: "%height%", batch_size: 1 } },
  "10": {
    class_type: "KSampler",
    inputs: {
      seed: "%seed%", steps: "%steps%", cfg: 1, sampler_name: "euler", scheduler: "simple",
      denoise: 1, model: ["1", 0], positive: ["7", 0], negative: ["8", 0], latent_image: ["9", 0],
    },
  },
  "11": { class_type: "VAEDecode", inputs: { samples: ["10", 0], vae: ["1", 2] } },
  "12": { class_type: "SaveImage", inputs: { filename_prefix: "weft", images: ["11", 0] } },
}, null, 2);

export const WORKFLOW_TOKENS = [
  "%prompt%", "%negative%", "%seed%", "%width%", "%height%", "%steps%", "%cfg%",
  "%sampler%", "%scheduler%", "%checkpoint%", "%ref1%", "%ref2%", "%ref3%", "%ref4%",
];

/** Substitute the run's values into a workflow. Numbers are matched WITH their quotes first so
 *  `"seed": "%seed%"` becomes `"seed": 1234` and not the string "1234" — ComfyUI validates input
 *  types and rejects the string, which is the single most common way a hand-edited workflow fails. */
function fillWorkflow(json: string, vals: Record<string, string | number>): string {
  let out = json;
  for (const [k, v] of Object.entries(vals)) {
    const tok = `%${k}%`;
    if (typeof v === "number") out = out.split(`"${tok}"`).join(String(v));
    out = out.split(tok).join(typeof v === "number" ? String(v) : jsonEscape(String(v)));
  }
  return out;
}

/** A value being spliced into JSON SOURCE has to survive as JSON. Prompts carry quotes, newlines
 *  and backslashes; one unescaped quote turns the whole graph into a parse error. */
function jsonEscape(s: string): string {
  const q = JSON.stringify(s);
  return q.slice(1, q.length - 1);
}

async function comfyUpload(ep: LocalImageEndpoint, dataUrl: string, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("image", dataUrlToBlob(dataUrl), name);
  fd.append("overwrite", "true");
  const res = await fetch(`${ep.url}/upload/image`, { method: "POST", body: fd, headers: authHeaders(ep) });
  if (!res.ok) throw new Error(`ComfyUI refused the reference upload (HTTP ${res.status})`);
  const j: any = await res.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

function authHeaders(ep: LocalImageEndpoint): Record<string, string> {
  return ep.key ? { Authorization: `Bearer ${ep.key}` } : {};
}

async function comfyGenerate(ep: LocalImageEndpoint, req: DiffusionRequest): Promise<DiffusionResult> {
  const t0 = Date.now();
  const { w, h } = sizeFor(ep, req.aspect);
  const seed = req.seed ?? Math.floor(Math.random() * 2147483647);
  const wf = (ep.workflow?.trim() || defaultWorkflow());

  // Reference images are uploaded first, and only when the workflow actually asks for one — an
  // upload the graph never reads is a wasted round trip on every single turn.
  const refVals: Record<string, string> = {};
  const wantsRefs = /%ref[1-4]%/.test(wf);
  if (wantsRefs && !req.refs?.length) {
    // A Kontext or IP-Adapter graph cannot run without its image, and the substituted token would
    // reach ComfyUI as a filename that does not exist — an error about LoadImage, three layers from
    // the actual cause, which is that nobody in this scene has a portrait yet.
    throw new Error("this workflow needs a reference image (%ref1%), and nobody in the scene has a portrait yet — generate portraits in Cast, or use a workflow without a %ref% token");
  }
  if (wantsRefs && req.refs?.length) {
    req.onProgress?.("sending the cast reference");
    const sheet = await buildReferenceSheet(req.refs);
    if (sheet) refVals.ref1 = await comfyUpload(ep, sheet, "weft-cast.jpg");
    // individual slots for workflows that wire several reference nodes
    for (let i = 1; i < Math.min(4, req.refs.length); i++) {
      if (wf.includes(`%ref${i + 1}%`)) refVals[`ref${i + 1}`] = await comfyUpload(ep, req.refs[i], `weft-ref${i + 1}.jpg`);
    }
  }

  const filled = fillWorkflow(wf, {
    prompt: req.prompt,
    negative: req.negative ?? ep.negative ?? DEFAULT_NEGATIVE,
    seed, width: w, height: h,
    steps: ep.steps || 25,
    cfg: ep.cfg ?? 5,
    sampler: ep.sampler || "euler",
    scheduler: ep.scheduler || "normal",
    checkpoint: pickCheckpoint(ep, req) || "",
    ...refVals,
  });

  let graph: unknown;
  try { graph = JSON.parse(filled); }
  catch (e: any) { throw new Error(`the workflow is not valid JSON after substitution — ${e.message}`); }

  req.onProgress?.("queued");
  const res = await fetch(`${ep.url}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(ep) },
    body: JSON.stringify({ prompt: graph, client_id: "weft" }),
    signal: req.signal,
  });
  if (!res.ok) {
    // ComfyUI's validation errors are genuinely useful — a missing checkpoint or an unknown node
    // is named exactly — so they are surfaced rather than flattened into "HTTP 400".
    const body = await res.text();
    throw new Error(`ComfyUI rejected the workflow (HTTP ${res.status}): ${comfyError(body)}`);
  }
  const { prompt_id } = await res.json() as { prompt_id: string };

  const deadline = Date.now() + (ep.timeout_s ?? 240) * 1000;
  for (;;) {
    if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (Date.now() > deadline) throw new Error(`ComfyUI did not finish within ${ep.timeout_s ?? 240}s — raise the timeout, or lower steps/resolution`);
    await new Promise((r) => setTimeout(r, 900));
    const hr = await fetch(`${ep.url}/history/${prompt_id}`, { headers: authHeaders(ep), signal: req.signal });
    if (!hr.ok) continue;
    const hist: any = await hr.json();
    const entry = hist?.[prompt_id];
    if (!entry) { req.onProgress?.("painting"); continue; }
    const status = entry.status?.status_str;
    if (status === "error" || entry.status?.completed === false && entry.status?.messages?.some((m: any) => m?.[0] === "execution_error")) {
      throw new Error(`ComfyUI errored while running the graph: ${comfyExecError(entry)}`);
    }
    const outputs = entry.outputs ?? {};
    for (const nodeId of Object.keys(outputs)) {
      const img = outputs[nodeId]?.images?.[0];
      if (!img) continue;
      req.onProgress?.("fetching the image");
      const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? "", type: img.type ?? "output" });
      const ir = await fetch(`${ep.url}/view?${q}`, { headers: authHeaders(ep), signal: req.signal });
      if (!ir.ok) throw new Error(`could not fetch the finished image (HTTP ${ir.status})`);
      const url = await shrinkDataUrl(await blobToDataUrl(await ir.blob()), ep.store_max_px ?? 1280);
      return { url, seed, took_ms: Date.now() - t0 };
    }
    if (entry.status?.completed) throw new Error("the workflow finished but produced no image — is there a SaveImage (or PreviewImage) node at the end?");
  }
}

function comfyError(body: string): string {
  try {
    const j = JSON.parse(body);
    const parts: string[] = [];
    if (j.error?.message) parts.push(j.error.message);
    if (j.error?.details) parts.push(String(j.error.details));
    for (const [node, e] of Object.entries<any>(j.node_errors ?? {})) {
      for (const err of e?.errors ?? []) parts.push(`node ${node}: ${err.message}${err.details ? ` (${err.details})` : ""}`);
    }
    return parts.join(" · ").slice(0, 400) || body.slice(0, 200);
  } catch { return body.slice(0, 200); }
}

function comfyExecError(entry: any): string {
  for (const m of entry?.status?.messages ?? []) {
    if (m?.[0] === "execution_error") {
      const d = m[1] ?? {};
      return `${d.node_type ?? "node"} — ${d.exception_message ?? "unknown error"}`.slice(0, 400);
    }
  }
  return "unknown error";
}

/* ── AUTOMATIC1111 / FORGE / SD.NEXT ─────────────────────────────────────────────────────────── */

async function a1111Generate(ep: LocalImageEndpoint, req: DiffusionRequest): Promise<DiffusionResult> {
  const t0 = Date.now();
  const { w, h } = sizeFor(ep, req.aspect);
  const seed = req.seed ?? Math.floor(Math.random() * 2147483647);
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    negative_prompt: req.negative ?? ep.negative ?? DEFAULT_NEGATIVE,
    seed, width: w, height: h,
    steps: ep.steps || 25,
    cfg_scale: ep.cfg ?? 5,
    sampler_name: ep.sampler || "Euler",
    scheduler: ep.scheduler || undefined,
    batch_size: 1, n_iter: 1,
    ...(pickCheckpoint(ep, req) ? { override_settings: { sd_model_checkpoint: pickCheckpoint(ep, req) }, override_settings_restore_afterwards: false } : {}),
  };
  req.onProgress?.("painting");
  const res = await fetch(`${ep.url}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(ep) },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`the image server returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  const b64 = j.images?.[0];
  if (!b64) throw new Error("the image server returned no image");
  const url = await shrinkDataUrl(`data:image/png;base64,${b64}`, ep.store_max_px ?? 1280);
  return { url, seed, took_ms: Date.now() - t0 };
}

/* ── THE DOOR ────────────────────────────────────────────────────────────────────────────────── */

export async function generateLocalImage(req: DiffusionRequest): Promise<DiffusionResult> {
  const ep = getLocalImage();
  if (!ep) throw new Error("no local image server is configured — set one up in Settings → Local images, or pick a cloud image model");
  try {
    return ep.backend === "a1111" ? await a1111Generate(ep, req) : await comfyGenerate(ep, req);
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    // A browser fetch to a server that is down, or one that has not been told to allow this origin,
    // fails identically ("Failed to fetch"), and CORS is by far the likelier of the two — so say so.
    if (/failed to fetch|networkerror|load failed/i.test(String(e?.message))) {
      throw new Error(
        ep.backend === "a1111"
          ? `could not reach ${ep.url}. Start the WebUI with --api --cors-allow-origins=${origin()}`
          : `could not reach ${ep.url}. Start ComfyUI with --enable-cors-header ${origin()} (and check the port)`,
      );
    }
    throw e;
  }
}

function origin(): string {
  try { return window.location.origin; } catch { return "*"; }
}

/** Checkpoints the local server has on disk, for the model picker. Empty when the server is down
 *  or has not allowed this origin — which is not an error worth interrupting anyone over. */
export async function listLocalCheckpoints(): Promise<string[]> {
  const ep = getLocalImage();
  if (!ep) return [];
  try {
    if (ep.backend === "a1111") {
      const r = await fetch(`${ep.url}/sdapi/v1/sd-models`, { headers: authHeaders(ep) });
      if (!r.ok) return [];
      return ((await r.json()) as any[]).map((m) => String(m.title ?? m.model_name)).filter(Boolean);
    }
    const r = await fetch(`${ep.url}/object_info/CheckpointLoaderSimple`, { headers: authHeaders(ep) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const list = j?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(list) ? list.map(String) : [];
  } catch { return []; }
}

export { defaultWorkflow };
