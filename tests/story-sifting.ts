/* Smoke test: THE DRAMA ALREADY IN THE STATE, READ OUT OF IT.
 *
 * Every pressure source was something the engine was told to press on. Nothing looked at the
 * relationship web and noticed what it had become — "Mara wants Ossian, and Ossian wants Di" could
 * sit in the edges for fifty turns and never reach the page. The sifter reads the shapes (after Talk
 * of the Town's story recognizer and Winnow's partial sifting), opens them as threads, and closes
 * them when the state stops showing them. It never reads the player's own interior. */
import { siftSituations, siftStory, MAX_SIFTED_LIVE } from "../src/engine/sift";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const e = (from: string, to: string, o: any = {}) => ({ from, to, warmth: 0, trust: 0, power: 0, notes: "", updated_turn: 1, ...o });
const world = (edges: any[], extra: any = {}) => ({
  world: { current_turn: 30, present: ["char_player", "char_mara"], edges, threads: [], ...extra },
  characters: {
    char_player: { character_id: "char_player", name: "Joe Arden" },
    char_mara: { character_id: "char_mara", name: "Mara Quill" },
    char_ossian: { character_id: "char_ossian", name: "Ossian Quill" },
    char_di: { character_id: "char_di", name: "Di Stroud" },
    char_bo: { character_id: "char_bo", name: "Bo Tamm" },
    char_fay: { character_id: "char_fay", name: "Fay Holm", status: "dead" },
  },
  minds: {},
} as any);
const keys = (s: any) => siftSituations(s).map((x) => x.key);

/* ── 1. the shapes ───────────────────────────────────────────────────────────── */
{
  const s = world([
    e("char_mara", "char_ossian", { attraction: 60 }), e("char_ossian", "char_mara", { attraction: 0 }),
    e("char_ossian", "char_di", { attraction: 55 }),
  ]);
  const k = keys(s);
  check("a want that isn't returned, aimed at someone who wants somebody else, is a triangle", k.includes("triangle:char_mara:char_ossian:char_di"), k);
  check("...and is not also reported as plain unrequited", !k.includes("unrequited:char_mara:char_ossian"), k);
  check("Ossian wanting Di with nothing known back is plain unrequited", k.includes("unrequited:char_ossian:char_di"), k);
  check("the title says it in plain words", siftSituations(s)[0].title === "Mara Quill wants Ossian Quill, who wants Di Stroud", siftSituations(s)[0].title);
}
{
  const s = world([e("char_mara", "char_player", { attraction: 50 }), e("char_di", "char_player", { attraction: 45 })]);
  check("two people wanting the player is a rivalry, with the player as the one wanted", keys(s).includes("rivals:char_di:char_mara:char_player"), keys(s));
}
{
  const s = world([e("char_player", "char_mara", { attraction: 90 }), e("char_mara", "char_player", { attraction: 0 })]);
  check("the player's own desire is never read", keys(s).length === 0, keys(s));
}
{
  const s = world([e("char_bo", "char_di", { warmth: 50 }), e("char_di", "char_bo", { warmth: -30 })]);
  check("a friendship one side doesn't share", keys(s).includes("onesided:char_bo:char_di"), keys(s));
}
{
  const s = world([e("char_bo", "char_ossian", { trust: 70 }), e("char_ossian", "char_bo", { warmth: -40 })]);
  check("trusting someone who means you no good", keys(s).includes("trust:char_bo:char_ossian"), keys(s));
}
{
  const s = world([
    e("char_mara", "char_ossian", { roles: ["sister"] }), e("char_mara", "char_di", { warmth: 55 }),
    e("char_ossian", "char_di", { warmth: -50 }),
  ]);
  check("bound to two people who are at war is being caught between them", keys(s).includes("between:char_mara:char_di:char_ossian"), keys(s));
}
{
  const s = world([]);
  s.characters.char_bo.drive = { goal: "get Di to sell the mill", about: "char_di" };
  s.characters.char_ossian.drive = { goal: "make Di forgive the debt", about: "char_di" };
  check("two people each after something from the same person", keys(s).includes("same:char_bo:char_ossian:char_di"), keys(s));
}
{
  const s = world([e("char_mara", "char_fay", { attraction: 80 })]);
  check("the dead are in no situations", keys(s).length === 0, keys(s));
}
{
  const s = world([e("char_mara", "char_ossian", { attraction: 60, roles: ["wife"] }), e("char_ossian", "char_mara", { attraction: 0, roles: ["husband"] })]);
  check("a cooled marriage is not unrequited love", !keys(s).some((k) => k.startsWith("unrequited")), keys(s));
}

/* ── 2. threads: opened, kept current, closed ────────────────────────────────── */
{
  const s = world([e("char_mara", "char_player", { attraction: 50, warmth: 30 }), e("char_di", "char_player", { attraction: 45 })]);
  const log = siftStory(s, 30);
  const t = s.world.threads[0];
  check("a situation becomes a thread", t?.sifted === "rivals:char_di:char_mara:char_player" && t.kind === "relationship" && t.status === "active", t);
  check("with what would move it on", /What would move it on: one of them finds out about the other/.test(t?.description ?? ""), t?.description);
  check("and a modest tension", t.tension >= 2 && t.tension <= 5, t.tension);
  check("the report says something is taking shape", /Something is taking shape: Di Stroud and Mara Quill both want Joe Arden/.test(log[0] ?? ""), log);
  siftStory(s, 31);
  check("it is not opened twice", s.world.threads.filter((x: any) => x.sifted === t.sifted).length === 1);
  s.world.edges[1].attraction = 10;      // Di has gone off him
  const gone = siftStory(s, 32);
  check("when the state stops showing it, it closes", t.status === "resolved" && t.turn_resolved === 32, t);
  check("and says so", /come apart on its own/.test(gone[0] ?? ""), gone);
  s.world.edges[1].attraction = 50;
  siftStory(s, 35);
  check("and does not snap back open the next time the numbers wobble", s.world.threads.filter((x: any) => x.status === "active").length === 0);
}
{
  // far away and nothing to do with the player: noticed, but not pressed on
  const s = world([e("char_bo", "char_di", { warmth: 50 }), e("char_di", "char_bo", { warmth: -30 })]);
  s.world.present = ["char_player"];
  siftStory(s, 30);
  check("a situation among people the player has no tie to is not opened", s.world.threads.length === 0, s.world.threads);
  s.world.edges.push(e("char_bo", "char_player", { warmth: 40, trust: 20 }));
  siftStory(s, 31);
  check("once one of them matters to the player, it is", s.world.threads.length === 1, s.world.threads);
}
{
  // a crowded web: never more than the cap live, one new a turn
  const s = world([
    e("char_mara", "char_player", { attraction: 60, warmth: 40 }), e("char_di", "char_player", { attraction: 60, warmth: 40 }),
    e("char_bo", "char_player", { attraction: 60, warmth: 40 }), e("char_ossian", "char_player", { attraction: 60, warmth: 40 }),
  ]);
  siftStory(s, 30);
  check("one new situation a turn", s.world.threads.length === 1);
  for (let t = 31; t < 40; t++) siftStory(s, t);
  check(`never more than ${MAX_SIFTED_LIVE} live at once`, s.world.threads.filter((x: any) => x.status === "active").length === MAX_SIFTED_LIVE, s.world.threads.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
