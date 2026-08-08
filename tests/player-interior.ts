/* Smoke test: THE PLAYER'S CARD HAS TO DESCRIBE THE PERSON IN THE PROSE.
 *
 * A save arrived where the narrator had the player flat, clean and moving on — "nothing moved in his
 * chest… none of it reached him" — and his own card said something else entirely:
 *
 *   active_states: obsessive, devastated, hyper-aware of her sounds — all stamped around turn 70
 *                  and never released once; the save was on turn 122
 *   mood:          "…not the quiet after the door closes. The quiet after the door closes, the quiet
 *                   after the door closes. The quiet after the door closes." (a degenerate loop)
 *   core memory:   "Rabi apologized to Tessa for his lack of trust, convinced that her loyalty
 *                   remained intact throughout the affair."
 *   edge → Tessa:  warmth 9, trust 5, note "Rabi's silent disgust marks a deepening emotional
 *                   withdrawal"
 *
 * Four separate mechanisms, one symptom: the card was reporting a man he had stopped being fifty
 * turns earlier, and every one of those fields goes back into the next prompt.
 *
 * The rule this all serves is that the engine never AUTHORS the player's interior. It was being
 * enforced by skipping the player, which is a different thing — it made the player the only person
 * in the game who could never put a feeling down. */
import { newSave, registerCharacter } from "../src/engine/state";
import { tickEmotions, cleanMood } from "../src/engine/emotions";
import { cleanMemoryContent } from "../src/engine/memory";
import { applyEdgeDelta, getEdge } from "../src/engine/social";
import type { SaveState, SocialEdge } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world(): SaveState {
  const s = newSave("interior", { name: "The Arrangement" } as any);
  registerCharacter(s, { name: "Rabi", character_id: "char_player" } as any);
  registerCharacter(s, { name: "Tessa" } as any);
  s.world.current_turn = 122;
  return s;
}
const tessaId = (s: SaveState) => Object.keys(s.characters).find((k) => s.characters[k].name === "Tessa")!;

/* ── 1. the mood loop ────────────────────────────────────────────────────────── */
{
  const loop = "The hardening softens into quiet; the absence of having to perform; still unresolved, the textness, "
    + "not the quiet after the door closes. The quiet after the door closes, the quiet after the door closes, "
    + "not the quiet after the door closes. The quiet after the door closes, the quiet after the door closes.";
  const out = cleanMood(loop);
  check("a degenerate mood is cut down", out.length < 120, out);
  check("the loop itself does not survive", (out.match(/quiet after the door closes/g) ?? []).length <= 1, out);
  check("and what it was actually saying is kept", out.startsWith("The hardening softens into quiet"), out);

  check("an ordinary mood passes through", cleanMood("flat, clean stillness") === "flat, clean stillness");
  check("a one-word mood passes through", cleanMood("hardened") === "hardened");
  check("nothing stays nothing", cleanMood("") === "" && cleanMood(undefined) === "");
  check("a negated echo counts as the repeat it is",
    cleanMood("the door closes, not the door closes, and the door closes") === "the door closes");
}

/* ── 2. the player sheds what has outlived its cause ─────────────────────────── */
{
  const s = world();
  const p = s.condition.char_player.psyche;
  p.active_states = ["shame-flushed", "devastated", "obsessive"];
  // state_ages stores the TURN a feeling was stamped, not how old it is
  p.state_ages = { "shame-flushed": 102, devastated: 75, obsessive: 70 };
  p.relaxation = -3.3;                      // clenched: he will never reach the self-liberation line
  const shifts = tickEmotions(s);
  check("a shame nothing has touched in twenty turns is let go", !p.active_states.includes("shame-flushed"), p.active_states);
  check("so are the rest of the stuck states", p.active_states.length === 0, p.active_states);
  check("and each one leaves its information behind", shifts.length === 3, shifts);
  check("shame leaves honesty behind", shifts.some((x) => /shame-flushed loosens into honesty/.test(x)), shifts);
}

/* ── 3. but releasing is the ONLY thing done to the player ───────────────────── */
{
  const s = world();
  const p = s.condition.char_player.psyche;
  p.active_states = ["devastated"];
  p.state_ages = { devastated: 119 };        // 3 turns old: gripped, not outlived
  p.relaxation = -4;
  p.mood = "even";
  const before = p.relaxation;
  tickEmotions(s);
  check("a fresh feeling is not taken away from the player", p.active_states.includes("devastated"), p.active_states);
  check("the engine does not move the player's relaxation", p.relaxation === before, p.relaxation);
  check("and does not decide the player's weather", p.mood === "even", p.mood);
}

/* ── 4. a feeling the story keeps naming is not retired ──────────────────────── */
{
  const s = world();
  const p = s.condition.char_player.psyche;
  p.active_states = ["devastated"];
  p.state_ages = { devastated: 122 };        // named again THIS turn (applyDiff restamps on re-add)
  p.relaxation = -4;
  tickEmotions(s);
  check("a state re-lit this turn stays", p.active_states.includes("devastated"), p.active_states);
}

/* ── 5. nothing changed for everyone else ────────────────────────────────────── */
{
  const s = world();
  const t = tessaId(s);
  s.world.present = [t];
  const p = s.condition[t].psyche;
  p.active_states = ["ashamed"];
  p.state_ages = { ashamed: 120 };
  p.relaxation = 4;                          // settled: self-liberation, exactly as before
  const shifts = tickEmotions(s);
  check("a settled body still releases at two turns", !p.active_states.includes("ashamed"), p.active_states);
  check("with its residue", shifts.some((x) => /Tessa's ashamed/.test(x)), shifts);
}
{
  const s = world();
  const t = tessaId(s);
  s.world.present = [t];
  const p = s.condition[t].psyche;
  p.active_states = ["devastated"];
  p.state_ages = { devastated: 119 };        // age 3, clenched
  p.relaxation = -4;
  const before = p.relaxation;
  const shifts = tickEmotions(s);
  check("a clenched NPC still re-tells it", shifts.some((x) => /keeps re-telling/.test(x)), shifts);
  check("and still pays for it", p.relaxation < before, p.relaxation);
}

/* ── 6. the note and the numbers describe the same relationship ──────────────── */
const edge = (over: Partial<SocialEdge> = {}): SocialEdge[] => {
  const edges: SocialEdge[] = [];
  const e = getEdge(edges, "char_player", "char_t");
  Object.assign(e, { warmth: 9, trust: 5.4, ...over });
  return edges;
};
{
  const edges = edge();
  applyEdgeDelta(edges, { from: "char_player", to: "char_t", warmth_delta: -2, trust_delta: -1, power_delta: 0,
    note: "Rabi's silent disgust marks a deepening emotional withdrawal." }, 122);
  const e = getEdge(edges, "char_player", "char_t");
  check("a bond the note calls disgust does not read warm", e.warmth < 0, e.warmth);
  check("and does not read trusting", e.trust < 0, e.trust);
}
{
  const edges = edge({ warmth: -2, trust: -2.8 });
  applyEdgeDelta(edges, { from: "char_player", to: "char_t", warmth_delta: -1, trust_delta: -1, power_delta: 0,
    note: "Rabi views John with open contempt." }, 122);
  const e = getEdge(edges, "char_player", "char_t");
  check("open contempt is not worth two points", e.warmth <= -8, e.warmth);
}
{
  const edges = edge({ warmth: -70, trust: -80 });
  applyEdgeDelta(edges, { from: "char_player", to: "char_t", warmth_delta: 0, trust_delta: 0, power_delta: 0,
    note: "She is estranged from him now." }, 122);
  const e = getEdge(edges, "char_player", "char_t");
  check("a deeper estrangement is never softened toward zero", e.warmth === -70 && e.trust === -80, e);
}
{
  const edges = edge({ warmth: 40, trust: 35 });
  applyEdgeDelta(edges, { from: "char_player", to: "char_t", warmth_delta: 3, trust_delta: 2, power_delta: 0,
    note: "She withdrew her hand from the table and looked away." }, 122);
  const e = getEdge(edges, "char_player", "char_t");
  check("ordinary friction is not a rupture", e.warmth > 0 && e.trust > 0, e);
}
{
  const edges = edge({ warmth: 60, trust: 55 });
  applyEdgeDelta(edges, { from: "char_player", to: "char_t", warmth_delta: 4, trust_delta: 3, power_delta: 0,
    note: "He refilled her glass before she noticed it was empty." }, 122);
  const e = getEdge(edges, "char_player", "char_t");
  check("a warm note stays warm", e.warmth > 60, e.warmth);
}

/* ── 7. the player's own memory records the act, not a ruling on the motive ──── */
{
  const opts = { name: "Rabi", isPlayer: true };
  const got = cleanMemoryContent("Rabi apologized to Tessa for his lack of trust, convinced that her loyalty remained intact throughout the affair.", opts);
  check("the verdict on what the player believed is dropped", !!got && !/convinced/.test(got), got);
  check("what he actually did survives", !!got && /apologized to Tessa/.test(got), got);

  const kept = cleanMemoryContent("He packed his belongings and his mother's spare key, deciding he could no longer stay in a marriage where he felt insufficient.", opts);
  check("a decision he made is not a verdict, and stays", !!kept && /no longer stay/.test(kept), kept);

  const plain = cleanMemoryContent("Tessa confessed she has been sleeping with a man named John in our bed for months.", opts);
  check("an ordinary account is untouched", plain === "Tessa confessed she has been sleeping with a man named John in our bed for months.", plain);

  // an NPC's interior IS the bookkeeper's job — this only ever applies to the player
  const npc = cleanMemoryContent("Tessa let him go, convinced she had no right to stop him.", { name: "Tessa", isPlayer: false });
  check("an NPC keeps their interpreted interior", !!npc && /convinced/.test(npc), npc);

  // never shred a memory down to a fragment chasing a clause
  const short = cleanMemoryContent("Rabi left, knowing it was over.", opts);
  check("a short memory is not shredded into a fragment", short === "Rabi left, knowing it was over.", short);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
