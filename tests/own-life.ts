/* Smoke test: THE PART OF A PERSON THAT IS NOT ABOUT THE PLAYER.
 *
 * The wife, 95 turns on screen out of 108: fourteen beliefs, thirty-three episodic memories, and
 * 100% of all forty-seven of them named her husband. Not most — all.
 *
 * She is an obstetrics resident who can explain the EPR paradox, meditates, knows the Latin name of
 * every plant on the street, sang in a choir as a child and still will not sing where anyone can
 * hear, and has been hiding an escalating symptom from her own doctors for three days. None of it
 * had ever been in front of the pass that decides what she believes, which received: her name, how
 * long she had known the player, her goal, her standing toward other people, and memories from
 * scenes the player was in. It could not have written anything else. Fifth instance this month of
 * the same root cause — a pass asked to act on state it is never given.
 *
 * The cruel part is which character it hits hardest. Somebody OFFSTAGE gets an independent life from
 * the world sim, filed as memories with source "offstage". Somebody always in the room never
 * qualifies. So the person the story is most about is the only one structurally incapable of having
 * a thought that is not about the player. */
import { ownLifeBlock, REFLECTION_SYSTEM } from "../src/engine/prompts";
import type { SaveState } from "../src/engine/types";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const save = (over: Record<string, unknown> = {}): SaveState => ({
  characters: {
    char_player: { name: "Rabi", core_traits: [], values: [] },
    char_jess: {
      name: "Jess", core_traits: [], values: [],
      texture: ["Always cold, wears thick socks even in summer.", "Knows the scientific name for every plant in the neighborhood."],
      skills: { "OB/GYN Residency": "Developing expert.", "Singing": "Sang in a choir as a child, but never where anyone can hear." },
    },
  },
  world: {
    current_turn: 108,
    threads: [
      { status: "active", title: "The first cramp", description: "Jess has begun logging a symptom she is not telling anyone about, including her doctors." },
      { status: "active", title: "Stakes in the ground", description: "Jess explicitly asked Rabi to say no so she could break that no." },
      { status: "resolved", title: "An old one of hers", description: "Jess finished this long ago." },
    ],
  },
  condition: { char_jess: { injuries: [], conditions: [] } },
  ...over,
} as unknown as SaveState);

/* ── the material exists and now reaches the pass ────────────────────────────── */
{
  const b = ownLifeBlock(save(), "char_jess");
  check("what she raises unprompted is there", /thick socks/.test(b), b);
  check("and what she can hold forth on", /EPR|OB\/GYN|Residency/.test(b), b);
  check("including the one she never does in front of anyone", /choir/.test(b), b);
  check("the block says a conviction need not be about a person at all", /does not have to be about anybody/.test(b));
}
{
  // the most belief-shaped thing in the whole state, and it was never shown
  const b = ownLifeBlock(save(), "char_jess");
  check("a worry she is carrying alone is included", /first cramp/.test(b), b);
  check("and it is marked as hers, not shared", /CARRYING ALONE/.test(b));
  check("a thread that is really about the player is not called hers", !/Stakes in the ground/.test(b), b);
  check("nor is a thread she already finished", !/An old one of hers/.test(b), b);
}
{
  const s = save();
  (s.condition as any).char_jess = { injuries: [{ type: "a cramp that has outgrown the log" }], conditions: ["exhausted"] };
  const b = ownLifeBlock(s, "char_jess");
  check("her own body is material for a belief", /outgrown the log/.test(b) && /exhausted/.test(b), b);
}
{
  // a bit-player with an empty card must not get an empty heading with nothing under it
  const s = save();
  (s.characters as any).char_extra = { name: "A courier", core_traits: [], values: [] };
  check("somebody with no life on file gets no block", ownLifeBlock(s, "char_extra") === "");
  check("and an unknown id is harmless", ownLifeBlock(s, "char_nobody") === "");
}
{
  // two characters sharing a first name fragment must not inherit each other's worries
  const s = save();
  (s.characters as any).char_jessica = { name: "Jessica", core_traits: [], values: [], texture: ["Keeps bees."] };
  const b = ownLifeBlock(s, "char_jessica");
  check("a similar name does not steal somebody else's thread", !/first cramp/.test(b) || /bees/.test(b), b);
}

/* ── the contract now asks for it ────────────────────────────────────────────── */
{
  const t = REFLECTION_SYSTEM;
  check("the contract says a person is not only their relationships", /NOT ONLY THEIR RELATIONSHIPS/.test(t));
  check("it names the failure with the real number", /fourteen beliefs|forty-seven/.test(t));
  check("it asks for a replacement when everything orbits one person", /replace one of them/.test(t));
  check("and forbids inventing a hobby to satisfy the rule", /Do not manufacture/.test(t));
  check("the older rules it sits beside are intact — standing still outranks the memories",
    /MAY NOT CONTRADICT HOW THIS PERSON ACTUALLY STANDS/.test(t));
  check("and one conviction per subject survives", /ONE CONVICTION PER SUBJECT/.test(t));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
