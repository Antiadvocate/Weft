/* Smoke test: DELETE A PERSON, A THREAD OR A CHAPTER, AND KEEP IT DELETED.
 *
 * The player: "I need the ability to delete characters sometimes completely, and threads and
 * chronicles completely. Or edit every aspect of them. I don't want the narrator to bring them back
 * into a story after." Sending someone away left their record and everything said about them;
 * retiring a thread left it to be woken by the bookkeeper; chapter summaries, read by the narrator
 * every turn as STORY SO FAR, couldn't be touched at all. */
import { nukeStoryline, planNuke, personNames, guardNuked, matcher } from "../src/engine/nuke";
import { deleteThread, editThread, isDeletedThread } from "../src/engine/threads";
import { siftStory } from "../src/engine/sift";
import { editChapter, deleteChapter, liveChapters } from "../src/engine/chapters";
import { nameIsRetired } from "../src/engine/turn";
import { newSave } from "../src/engine/state";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world() {
  const s = newSave("Valley", { name: "Valley", era: "Now", tone: "Drama" } as any);
  s.world.places["loc_house"] = { id: "loc_house", name: "Rabi and May's House", contains: [] } as any;
  s.world.player_location = "loc_house";
  s.characters = {
    char_player: { character_id: "char_player", name: "Rabi", location: "loc_house" },
    char_may: { character_id: "char_may", name: "May", location: "loc_house", background: "She works in benefits." },
    char_ellie: { character_id: "char_ellie", name: "Ellie Navarro", location: "loc_house" },
    char_sonia: { character_id: "char_sonia", name: "Sonia Vale", location: "loc_house", background: "Runs the office. She may retire in May." },
  } as any;
  s.memory = {
    char_may: { episodic: [{ content: "Ellie let herself into the house." }, { content: "Rabi made coffee. We may go out later." }], facts: [], core: [] },
    char_sonia: { episodic: [{ content: "I asked May about the June cohort." }, { content: "We may close early on Friday." }], facts: [], core: [] },
    char_ellie: { episodic: [{ content: "I like the lake." }], facts: [], core: [] },
  } as any;
  s.world.rumors = [{ id: "r1", content: "Ellie Navarro was arrested.", holders: ["char_may"] }] as any;
  s.world.edges = [{ from: "char_ellie", to: "char_player", warmth: -30, trust: -70, power: 0 }, { from: "char_may", to: "char_player", warmth: 40, trust: 40, power: 0 }] as any;
  s.world.present = ["char_may", "char_ellie"];
  s.history = [{ turn: 5, player_action: "I make coffee", narrator_prose: "May yawns. Ellie walks in with groceries. You may want to sit down, May says.", summary: "Ellie arrived with groceries." }] as any;
  s.world.threads = [
    { id: "t1", title: "The Beacon Works load review", status: "active", description: "Who checks the number.", tension: 5, turn_started: 1 },
    { id: "t2", title: "May's benefits paperwork", status: "resolved", description: "", tension: 0, turn_started: 1 },
  ] as any;
  s.chapters = [
    { idx: 1, from_turn: 1, to_turn: 20, title: "The Contact Line", summary: "Rabi argued with May about the Beacon contact." },
    { idx: 2, from_turn: 21, to_turn: 40, title: "Quiet Days", summary: "They cooked." },
  ] as any;
  return s;
}

// ── a person, completely ──
{
  const s = world();
  check("a deleted person goes by their full name and an unshared first name", JSON.stringify(personNames(s, ["char_ellie"])) === JSON.stringify(["Ellie Navarro", "Ellie"]));
  const plan = planNuke(s, "", { removePeople: ["char_ellie"] });
  check("the preview changes nothing", !!s.characters.char_ellie && plan.removed[0] === "Ellie Navarro");
  const r = nukeStoryline(s, "", { removePeople: ["char_ellie"] });
  check("their record goes", !s.characters.char_ellie && !s.memory.char_ellie && !s.world.edges.some((e) => e.from === "char_ellie"));
  check("so does everything said about them", !s.memory.char_may.episodic.some((m: any) => /Ellie/.test(m.content)) && s.world.rumors.length === 0);
  check("and the sentences that mention them in past turns", !/Ellie/.test(s.history[0].narrator_prose) && /May yawns\./.test(s.history[0].narrator_prose), s.history[0].narrator_prose);
  check("their name is retired, so nobody new turns up under it", nameIsRetired(s, "Ellie Navarro"));
  check("it's recorded as never having existed", s.retcons!.some((x) => /Ellie Navarro has never existed/.test(x.text)) && JSON.stringify(s.world.nuked?.[0].names) === JSON.stringify(["Ellie Navarro", "Ellie"]));
  check("the narrator can't bring them back", guardNuked(s, "Ellie knocks at the door. May looks up.", "I wait").prose === "May looks up.");
  check("unless the player names them", guardNuked(s, "Ellie knocks at the door.", "I call Ellie").cut === 0);
  check("the report names who went", r.removed[0] === "Ellie Navarro");
}
{
  const s = world();
  nukeStoryline(s, "", { removePeople: ["char_may"] });
  check("deleting May doesn't cut every sentence with 'may' in it", s.memory.char_sonia.episodic.some((m: any) => m.content === "We may close early on Friday.") && !s.memory.char_sonia.episodic.some((m: any) => /June cohort/.test(m.content)), s.memory.char_sonia.episodic);
  check("…a sentence with her name in it goes, one without stays", !/May yawns|May says/.test(s.history[0].narrator_prose) && /Ellie walks in/.test(s.history[0].narrator_prose), s.history[0].narrator_prose);
  check("…and in a background, 'may retire' survives while 'in May' goes with her name", s.characters.char_sonia.background === "Runs the office.", s.characters.char_sonia.background);
  const m = matcher([], ["May"])!;
  check("names match as written: 'May' yes, 'may' no", m.test("May said so") && !m.test("you may go"));
}

// ── a thread, completely ──
{
  const s = world();
  const gone = deleteThread(s, "t1");
  check("a deleted thread leaves the story", !!gone && !s.world.threads.some((t) => t.id === "t1"));
  check("and a reworded one can't be opened in its place", isDeletedThread(s, "Beacon Works load review dispute") && isDeletedThread(s, "the beacon works load review") && !isDeletedThread(s, "Sonia's scheduling authority"));
  check("a closed thread can be deleted too", !!deleteThread(s, "t2") && s.world.threads.length === 0);
  const t = world();
  editThread(t, "t1", { title: "The site walk", description: "Thursday at nine.", tension: 2, status: "dormant" });
  const e = t.world.threads[0];
  check("every part of a thread can be edited", e.title === "The site walk" && e.description === "Thursday at nine." && e.tension === 2 && e.status === "dormant");
  const turn = readFileSync("src/engine/turn.ts", "utf8");
  check("the bookkeeper refuses a deleted thread", /if \(isDeletedThread\(state, tu\.title\)\)/.test(turn) && /filter\(\(t\) => !isDeletedThread\(state, t\.title\)\)/.test(turn));
  check("so do the world's own passes", /!isDeletedThread\(state, title\)/.test(readFileSync("src/engine/offstage.ts", "utf8")) && /isDeletedThread\(state, title\)/.test(readFileSync("src/engine/montage-run.ts", "utf8")));
  const u = world();
  u.world.edges.push({ from: "char_sonia", to: "char_may", warmth: 0, trust: 0, power: 0, attraction: 60 } as any, { from: "char_may", to: "char_ellie", warmth: 0, trust: 0, power: 0, attraction: 60 } as any);
  siftStory(u, 6);
  const sifted = u.world.threads.find((x: any) => x.sifted);
  if (sifted) {
    deleteThread(u, sifted.id);
    siftStory(u, 30);
    check("story sifting doesn't reopen a pattern the player deleted", !u.world.threads.some((x: any) => x.sifted === (sifted as any).sifted));
  } else check("story sifting doesn't reopen a pattern the player deleted (nothing sifted to test)", true);
  const f = world();
  (f.world_bible as any).destination = "They move to Portland.";
  f.world.threads.push({ id: "thread_fate", title: "They move to Portland", status: "active", description: "", tension: 3, turn_started: 1 } as any);
  deleteThread(f, "thread_fate");
  check("deleting the ending's thread lets go of the ending", !(f.world_bible as any).destination);
}

// ── a chapter, completely ──
{
  const s = world();
  editChapter(s, 1, { title: "A Morning", summary: "Rabi and May had breakfast." });
  check("a chapter's title and summary can be edited", s.chapters![0].title === "A Morning" && s.chapters![0].summary === "Rabi and May had breakfast.");
  deleteChapter(s, 2);
  check("a deleted chapter is emptied", s.chapters![1].summary === "" && s.chapters![1].title === "" && (s.chapters![1] as any).deleted === true);
  check("and kept as a marker, so its turns aren't summarised again", s.chapters!.length === 2 && s.chapters!.at(-1)!.to_turn === 40);
  check("the narrator and the Chronicle skip it", liveChapters(s).length === 1 && /liveChapters\(state\)\.slice\(-6\)/.test(readFileSync("src/engine/prompts.ts", "utf8")) && /filter\(\(c\) => !c\.deleted\)/.test(readFileSync("src/views/Chronicle.tsx", "utf8")));
}

// ── the controls are where the player looks ──
{
  check("Cast: delete completely, with a preview", /api\.deleteCharacterPreview\(/.test(readFileSync("src/views/Cast.tsx", "utf8")) && /api\.deleteCharacter\(/.test(readFileSync("src/views/Cast.tsx", "utf8")));
  check("World: edit and delete on every thread, closed ones included", /api\.editThread\(/.test(readFileSync("src/views/World.tsx", "utf8")) && /api\.deleteThread\(/.test(readFileSync("src/views/World.tsx", "utf8")) && /closedThreads\.map/.test(readFileSync("src/views/World.tsx", "utf8")));
  check("Chronicle: edit and delete on every chapter", /api\.editChapter\(/.test(readFileSync("src/views/Chronicle.tsx", "utf8")) && /api\.deleteChapter\(/.test(readFileSync("src/views/Chronicle.tsx", "utf8")));
  check("every delete keeps an undo", (readFileSync("src/lib/api.ts", "utf8").match(/(deleteCharacter|deleteThread|deleteChapter): async[\s\S]{0,400}?putSideRow\(id, "recovery", s\)/g) ?? []).length === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
