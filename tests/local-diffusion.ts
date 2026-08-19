/* THE DIFFUSION MODEL ON YOUR OWN MACHINE — and the picture that arrives every message.
 *
 * A local sampler makes an illustration free, which is what allows the scene to be repainted every
 * turn instead of on a button. Four things have to hold or the feature is worse than not having it:
 *
 *   1. THE WORKFLOW SURVIVES SUBSTITUTION. ComfyUI validates input types: a seed arriving as the
 *      STRING "12345" is rejected with the same message as a broken graph, and it is the single
 *      most common way a hand-edited workflow fails. A prompt containing a quote must not turn the
 *      graph into a parse error either.
 *   2. NEGATIONS GO TO THE NEGATIVE PROMPT. A sampler has no "not" — every noun in the positive
 *      prompt is a vote FOR that noun, which is why the cloud path's "no text, no watermark, not a
 *      person" would produce text, watermarks and a person.
 *   3. THE SAME PERSON COMES BACK. A locked descriptor per character, and a seed derived from the
 *      place and the cast rather than rolled fresh — otherwise the world is redecorated and
 *      recast every time the player speaks.
 *   4. A PICTURE THAT FAILS IS NOT A TURN THAT FAILED. Nothing here may throw into the turn loop.
 */
import { newSave, registerCharacter } from "../src/engine/state";
import { buildSceneDiffusion, buildPortraitDiffusion, visualSignature, stableSeed } from "../src/engine/prompts";
import { setLocalImage, getLocalImage } from "../src/config";
import { generateLocalImage, defaultWorkflow, KONTEXT_WORKFLOW } from "../src/lib/diffusion";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

/* ── the browser bits the engine assumes ─────────────────────────────────────── */
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
(globalThis as any).window = { location: { origin: "http://localhost:5173" } };

/* ── a world with two people in a room ───────────────────────────────────────── */
const BIBLE = {
  name: "Harrow", era: "a wet northern winter", art_direction: "oil painting, muted palette",
  technology_level: "pre-industrial", magic_rules: "none", forbidden: "", what_people_fear: "the sea",
  cultures_and_languages: "english", climate_and_geography: "cold coast", calendar_and_currency: "standard",
  political_situation: "tense",
};

function world() {
  const s = newSave("test", { ...BIBLE } as any);
  registerCharacter(s, { character_id: "char_player", name: "Wren", age: 34 } as any);
  s.world.places = { p_kitchen: { id: "p_kitchen", name: "the kitchen", description_facts: "A low room with a stove and one window." } as any,
                     p_yard: { id: "p_yard", name: "the yard", description_facts: "Mud and a broken fence." } as any };
  s.world.player_location = "p_kitchen";
  s.world.current_time = "Day 2, 21:40";
  s.world.weather = "sleet";
  s.characters.char_player.name = "Wren";
  s.characters.char_player.appearance_facts = "tall, black hair cut short, a broken nose that set crooked";
  s.characters.char_player.age = 34;
  const id = registerCharacter(s, {
    name: "Sela", age: 29, appearance_facts: "small, red hair, freckles across the nose, green eyes",
    background: "a cook", core_traits: ["wry"], speech_pattern: "clipped", gregariousness: 0.4,
  } as any);
  s.world.present = [id];
  return { s, id };
}

/* ── 1. the workflow survives substitution ───────────────────────────────────── */
{
  const calls: { url: string; init: any }[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: "abc" }), { status: 200 });
    if (url.includes("/history")) {
      return new Response(JSON.stringify({ abc: { status: { completed: true }, outputs: { "7": { images: [{ filename: "x.png", subfolder: "", type: "output" }] } } } }), { status: 200 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } });
  };
  setLocalImage({ url: "http://127.0.0.1:8188", backend: "comfy", checkpoint: "sdxl.safetensors", steps: 20, cfg: 4.5 });
  const r = await generateLocalImage({
    // a prompt that would break a naively spliced graph: a quote, a backslash and a newline
    prompt: 'a "lit" window\\at dusk\nrain', seed: 12345, aspect: "landscape",
  });
  const body = JSON.parse(calls[0].init.body);
  const g = body.prompt;
  check("the graph reaches ComfyUI as parsed JSON", typeof g === "object" && !!g["5"]);
  check("the seed is a NUMBER, not the string ComfyUI rejects", g["5"].inputs.seed === 12345, g["5"]?.inputs);
  check("steps and cfg are numbers too", g["5"].inputs.steps === 20 && g["5"].inputs.cfg === 4.5, g["5"]?.inputs);
  check("the checkpoint from settings is used", g["1"].inputs.ckpt_name === "sdxl.safetensors");
  check("a prompt with quotes and newlines survives as one string", g["2"].inputs.text.includes('"lit"') && g["2"].inputs.text.includes("\n"));
  check("the negative prompt is its own node", typeof g["3"].inputs.text === "string" && g["3"].inputs.text.includes("watermark"));
  check("landscape asks for a landscape latent", g["4"].inputs.width > g["4"].inputs.height);
  check("the finished image comes back as a data URL", r.url.startsWith("data:"), r.url.slice(0, 40));
  check("and the seed it was drawn at comes back with it", r.seed === 12345);
}

/* ── the id in the image slot beats the one in settings ──────────────────────── */
{
  let sent: any = null;
  (globalThis as any).fetch = async (url: string, init: any) => {
    if (url.includes("/prompt")) { sent = JSON.parse(init.body).prompt; return new Response(JSON.stringify({ prompt_id: "abc" }), { status: 200 }); }
    if (url.includes("/history")) return new Response(JSON.stringify({ abc: { status: { completed: true }, outputs: { "7": { images: [{ filename: "x.png" }] } } } }), { status: 200 });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  await generateLocalImage({ prompt: "x", checkpoint: "flux1-dev.safetensors" });
  check("a local/<checkpoint> id overrides the settings field", sent["1"].inputs.ckpt_name === "flux1-dev.safetensors");
  await generateLocalImage({ prompt: "x", checkpoint: "default" });
  check("local/default falls back to the configured checkpoint", sent["1"].inputs.ckpt_name === "sdxl.safetensors");
}

/* ── reference images: uploaded only when the graph asks for one ─────────────── */
{
  const seen: string[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    seen.push(String(url));
    if (url.includes("/upload/image")) return new Response(JSON.stringify({ name: "weft-cast.jpg", subfolder: "" }), { status: 200 });
    if (url.includes("/prompt")) return new Response(JSON.stringify({ prompt_id: "abc" }), { status: 200 });
    if (url.includes("/history")) return new Response(JSON.stringify({ abc: { status: { completed: true }, outputs: { "9": { images: [{ filename: "x.png" }] } } } }), { status: 200 });
    return new Response(new Uint8Array([1]), { status: 200 });
  };
  const png = "data:image/png;base64,iVBORw0KGgo=";
  setLocalImage({ ...getLocalImage()!, workflow: undefined });
  await generateLocalImage({ prompt: "x", refs: [png, png] });
  check("no %ref% token in the graph → nothing is uploaded", !seen.some((u) => u.includes("/upload/image")));

  seen.length = 0;
  setLocalImage({ ...getLocalImage()!, workflow: KONTEXT_WORKFLOW });
  await generateLocalImage({ prompt: "x", refs: [png] });
  check("a workflow with %ref1% gets the portrait uploaded first", seen[0].includes("/upload/image"));

  // the unsatisfiable case: a reference workflow, and a scene where nobody has a portrait. The
  // token would otherwise reach ComfyUI as a filename that does not exist, and the error would be
  // about LoadImage rather than about the actual cause.
  let err = "";
  try { await generateLocalImage({ prompt: "x", refs: [] }); } catch (e: any) { err = String(e.message); }
  check("a reference workflow with no portraits says what to do about it", /portraits in Cast/.test(err), err);
  setLocalImage({ ...getLocalImage()!, workflow: undefined });
}

/* ── a server that is down says something a person can act on ────────────────── */
{
  (globalThis as any).fetch = async () => { throw new TypeError("Failed to fetch"); };
  let err = "";
  try { await generateLocalImage({ prompt: "x" }); } catch (e: any) { err = String(e.message); }
  check("an unreachable server names CORS and the flag that fixes it", /enable-cors-header/.test(err), err);

  (globalThis as any).fetch = async (url: string) => url.includes("/prompt")
    ? new Response(JSON.stringify({ error: { message: "Prompt outputs failed validation" }, node_errors: { "1": { errors: [{ message: "value not in list", details: "ckpt_name: 'nope.safetensors'" }] } } }), { status: 400 })
    : new Response("{}", { status: 200 });
  err = "";
  try { await generateLocalImage({ prompt: "x" }); } catch (e: any) { err = String(e.message); }
  check("a rejected graph reports which node and why", /ckpt_name/.test(err) && /node 1/.test(err), err);
}

/* ── 2. negations live in the negative prompt ────────────────────────────────── */
{
  const { s } = world();
  const d = buildSceneDiffusion(s, 'Sela set the pot down. "You said you were leaving," she said, and did not look up.', undefined, "natural");
  check("no watermark bar in the positive prompt", !/watermark/i.test(d.prompt), d.prompt);
  check("the negative carries it instead", /watermark/.test(d.negative));
  check("quoted dialogue never reaches the prompt", !/You said you were leaving/.test(d.prompt), d.prompt);
  check("but the action does", /pot/i.test(d.prompt), d.prompt);
  check("a two-hander bars the crowd the sampler would invent", /extra person/.test(d.negative));
  check("the art direction leads", d.prompt.toLowerCase().includes("oil painting"));
  check("the place is named", /kitchen/.test(d.prompt));
  check("the clock reaches the light", /dusk|night|failing light/.test(d.prompt), d.prompt);
  check("the engine's placeholder mood is not weighted as a word", !/\beven\b/.test(d.prompt), d.prompt);
  check("and the weather", /sleet/.test(d.prompt));

  const tags = buildSceneDiffusion(s, "Sela set the pot down.", undefined, "tags");
  check("tag dialect is comma-separated and shorter", tags.prompt.split(",").length > 4 && tags.prompt.length < d.prompt.length, tags.prompt);
}

/* ── 3. the same person, and the same room ───────────────────────────────────── */
{
  const { s, id } = world();
  const first = buildSceneDiffusion(s, "They talk.", undefined, "natural");
  // the appearance the portrait was drawn from is locked onto the character
  s.characters[id].visual_signature = visualSignature(s, id);
  const locked = s.characters[id].visual_signature!;
  check("the signature is built from bedrock appearance", /red hair/.test(locked) && /freckles/.test(locked), locked);
  check("and carries the age, not the mood", /29/.test(locked) && !/wry/.test(locked), locked);

  // play moves on: she changes clothes, gets hurt, and the description of the day is rewritten
  s.characters[id].appearance_now = "soaked through, an apron over it";
  s.condition[id] = { ...(s.condition[id] ?? {} as any), wearing: ["an apron"], injuries: [{ type: "split lip", functional_impact: "hurts to talk" }] } as any;
  const later = buildSceneDiffusion(s, "They talk again.", undefined, "natural");
  check("the locked words are still there, verbatim", later.prompt.includes(locked), later.prompt);
  check("and what changed is added beside them, not folded in", /apron/.test(later.prompt) && !/apron/.test(s.characters[id].visual_signature!));

  check("the same room with the same people keeps its seed", first.seed === later.seed);
  s.world.player_location = "p_yard";
  check("a different place gets a different one", buildSceneDiffusion(s, "Outside.", undefined, "natural").seed !== first.seed);
  s.world.player_location = "p_kitchen";
  check("asking for another take breaks the lock on purpose", buildSceneDiffusion(s, "x", undefined, "natural", { vary: 7 }).seed !== first.seed);
  check("and turning the lock off rolls fresh", buildSceneDiffusion(s, "x", undefined, "natural", { lockSeed: false }).seed !== first.seed);
  check("a hand-edited signature wins over the derived one", (() => {
    s.characters[id].visual_signature = "a woman made of birch bark";
    return buildSceneDiffusion(s, "x", undefined, "natural").prompt.includes("a woman made of birch bark");
  })());
}

/* ── a cast that is not human ────────────────────────────────────────────────── */
{
  const s = newSave("test2", { ...BIBLE } as any);
  registerCharacter(s, {
    character_id: "char_player", name: "Foot", age: 20,
    appearance_facts: "a bare human foot, waist-high, walking on its toes, no body above the ankle",
  } as any);
  const d = buildSceneDiffusion(s, "It crosses the floor.", [], "natural");
  check("nobody human in the scene → 'human, person' goes to the negative", /human, person/.test(d.negative), d.negative);
  const p = buildPortraitDiffusion(s, "char_player", "natural");
  check("and the portrait bars it too", /human/.test(p.negative), p.negative);
  check("the portrait asks for the whole being, not a standing figure", /whole being/.test(p.prompt), p.prompt);
}

/* ── portraits are stable under regeneration ─────────────────────────────────── */
{
  const { s, id } = world();
  const a = buildPortraitDiffusion(s, id, "natural");
  s.condition[id] = { ...(s.condition[id] ?? {} as any), psyche: { mood: "furious", relaxation: -9 } } as any;
  const b = buildPortraitDiffusion(s, id, "natural");
  check("regenerating a portrait returns the same seed, so it is the same face", a.seed === b.seed);
  check("but the mood does move the picture", /furious/.test(b.prompt) && !/furious/.test(a.prompt));
  check("seeds are deterministic across processes", stableSeed("scene:x:y") === stableSeed("scene:x:y"));
  check("and not all the same number", stableSeed("a") !== stableSeed("b"));
}

/* ── the A1111 path ──────────────────────────────────────────────────────────── */
{
  let body: any = null;
  (globalThis as any).fetch = async (_u: string, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ images: ["aGk="] }), { status: 200 });
  };
  setLocalImage({ url: "http://127.0.0.1:7860", backend: "a1111", steps: 18, cfg: 3, checkpoint: "pony.safetensors" });
  const r = await generateLocalImage({ prompt: "a room", negative: "text", seed: 99, aspect: "portrait" });
  check("one POST, no graph", body.prompt === "a room" && body.seed === 99);
  check("the negative is sent under the name A1111 uses", body.negative_prompt === "text");
  check("portrait orientation is taller than wide", body.height > body.width);
  check("the checkpoint is switched via override_settings", body.override_settings?.sd_model_checkpoint === "pony.safetensors");
  check("the image comes back as a data URL", r.url.startsWith("data:image"));
}

/* ── nothing configured is not a crash ───────────────────────────────────────── */
{
  setLocalImage(null);
  let err = "";
  try { await generateLocalImage({ prompt: "x" }); } catch (e: any) { err = String(e.message); }
  check("with no server configured it says so, and says where to fix it", /Settings/.test(err), err);
  check("the workflow template is valid JSON", (() => { try { JSON.parse(defaultWorkflow()); JSON.parse(KONTEXT_WORKFLOW); return true; } catch { return false; } })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
