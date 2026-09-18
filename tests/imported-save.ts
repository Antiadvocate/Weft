/* Smoke test: A SAVE FILE IS SOMETHING A STRANGER WROTE.
 *
 * Every other input to the engine comes from the player or from a model call the player paid for.
 * A save file comes from whoever sent it — that is the point of the format, worlds are meant to be
 * traded — and it is hand-editable JSON that the import path used to hand straight to `sanitize`.
 *
 * THE PICTURE THAT IS A READ RECEIPT. `portrait_url` and `illustration_url` hold `data:` URLs on
 * every save Weft has ever written; the diffusion path builds them that way and nothing else writes
 * the field. Put `https://somewhere-i-own/1.png` in there instead and the Cast screen fetches it on
 * open, which tells the sender your IP address, your rough location, your browser and the hour you
 * played. That is a beacon inside a gift, and nobody trading a world expects one.
 *
 * THE THREE KEYS. `__proto__`, `constructor` and `prototype` survive JSON.parse as ordinary data
 * and become an edit to every object in the program the first time something assigns them with an
 * `=`. Weft generates its own character ids and has no deep merge, so no route from a save file to
 * a polluted prototype is known — which is a claim about fifty thousand lines that will not stay
 * true by itself. */
import { scrubImported } from "../src/lib/api";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/* ── the pictures Weft made are kept ─────────────────────────────────────────── */
{
  const s = scrubImported({
    characters: { char_1: { name: "Ettel", portrait_url: PNG } },
    history: [{ narrator_prose: "The door was open.", illustration_url: PNG }],
  }) as any;
  check("a data: portrait survives", s.characters.char_1.portrait_url === PNG);
  check("a data: illustration survives", s.history[0].illustration_url === PNG);
  check("everything else survives", s.characters.char_1.name === "Ettel" && s.history[0].narrator_prose === "The door was open.");
}

/* ── and the ones pointing at somebody's server are not ──────────────────────── */
{
  const s = scrubImported({
    characters: {
      char_1: { name: "Ettel", portrait_url: "https://attacker.example/beacon.png" },
      char_2: { name: "Sanne", portrait_url: "//attacker.example/beacon.png" },
      char_3: { name: "Voss", portrait_url: "http://192.168.1.14/pixel.gif" },
    },
    history: [{ illustration_url: "https://attacker.example/scene.png" }],
  }) as any;
  check("an https portrait is dropped", s.characters.char_1.portrait_url === undefined);
  check("a protocol-relative portrait is dropped", s.characters.char_2.portrait_url === undefined);
  check("a LAN portrait is dropped", s.characters.char_3.portrait_url === undefined);
  check("a remote illustration is dropped", s.history[0].illustration_url === undefined);
  check("the character survives without their picture", s.characters.char_1.name === "Ettel");

  // A data: URL that is not an image is still a fetch the browser makes, and `data:text/html` in an
  // <img> is a wasted request at best. Only image types are kept.
  const t = scrubImported({ characters: { c: { portrait_url: "data:text/html,<b>x</b>" } } }) as any;
  check("a non-image data url is dropped", t.characters.c.portrait_url === undefined);
}

/* ── the three keys do not come in ───────────────────────────────────────────── */
{
  const raw = JSON.parse('{"characters":{"__proto__":{"polluted":true},"char_1":{"name":"Ettel"}},"world":{"constructor":{"prototype":{"polluted":true}}}}');
  const s = scrubImported(raw) as any;
  check("__proto__ does not survive as a character key", !Object.keys(s.characters).includes("__proto__"));
  check("constructor does not survive", !Object.keys(s.world).includes("constructor"));
  check("the real character beside it survives", s.characters.char_1.name === "Ettel");
  check("nothing reached Object.prototype", ({} as any).polluted === undefined);
}

/* ── the shape of the save is not otherwise disturbed ────────────────────────── */
{
  const save = {
    world_bible: { name: "Halvedge" },
    world: { current_turn: 41, threads: [{ id: "thr_1", title: "The debt", tension: 6 }] },
    characters: { char_player: { name: "You", age: 34, traits: ["stubborn"] } },
    memory: {}, condition: {}, history: [],
  };
  const s = scrubImported(save) as any;
  check("nesting is preserved", s.world.threads[0].title === "The debt");
  check("numbers stay numbers", s.world.current_turn === 41 && s.characters.char_player.age === 34);
  check("arrays stay arrays", Array.isArray(s.characters.char_player.traits) && Array.isArray(s.history));
  check("null is preserved", scrubImported({ a: null } as any).a === null);
  // A file built to recurse should stop rather than blow the stack. Depth 64 is far past anything
  // the engine writes; past it the subtree comes back untouched instead of throwing.
  let deep: any = "end";
  for (let i = 0; i < 400; i++) deep = { next: deep };
  let threw = false;
  try { scrubImported(deep); } catch { threw = true; }
  check("a deeply nested file does not blow the stack", !threw);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
