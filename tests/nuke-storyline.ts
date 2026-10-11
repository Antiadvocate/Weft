/* Smoke test: NUKE A STORYLINE.
 *
 * Rainier Valley: "Beacon Works" was in about a hundred and fifty places in the save, and every one
 * of them put it in front of the narrator again. The player asked for a nuke from orbit. This takes
 * a few words and removes them from everything the models read, keeps the people, and keeps them out. */
import { nukeStoryline, planNuke, nukeCandidates, nukeSuggestions, guardNuked, cutSentences, termRegex, nukeTerms } from "../src/engine/nuke";
import { newSave } from "../src/engine/state";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

function world() {
  const s = newSave("Rainier Valley", { name: "Rainier Valley", era: "Contemporary Seattle", political_situation: "City Light is short-staffed. The Beacon Works permit is behind." } as any);
  for (const [id, name] of [["loc_house", "Rabi and May's House"], ["loc_tower", "Seattle Municipal Tower"], ["loc_beacon", "Beacon Works"]]) {
    s.world.places[id] = { id, name, contains: [], description_facts: name === "Seattle Municipal Tower" ? "A glass tower. Beacon Works drawings cover one wall." : "" } as any;
  }
  s.travel_log = [{ turn: 1, place: "loc_house" }, { turn: 5, place: "loc_tower" }, { turn: 9, place: "loc_beacon" }];
  s.world.player_location = "loc_tower";
  s.characters = {
    char_player: { character_id: "char_player", name: "Rabi", location: "loc_tower", self_stated: [{ text: "Beacon Works is not my project.", turn: 52 }, { text: "I'm a project manager.", turn: 40 }] },
    char_ellie: { character_id: "char_ellie", name: "Ellie Navarro", central: true, location: "loc_tower",
      background: "Grew up in Tacoma. Ellie has only one project, Beacon Works. She swims at Seward Park.",
      current_goal: "Finish the Beacon Works capacity review.",
      drive: { goal: "Gather documentation on the Beacon Works feeder error.", progress: 0.2 },
      drive_queue: [{ goal: "Get Rabi to notice her." }],
      voice: { example_lines: ["The Beacon number is wrong.", "I need the lake."] },
      schedule: { blocks: [{ what: "Site walk", where: "Beacon Works" }, { what: "Desk hours", where: "Seattle Municipal Tower" }] },
      authored: { want: "Get Rabi to cheat on May." } },
    char_andre: { character_id: "char_andre", name: "Andre Sol", location: "loc_beacon", background: "Eleven years a field electrician.", drive: { goal: "Label every breaker in the Beacon Works switchgear room." }, drive_refreshed_time: "Day 1" },
    char_beacon: { character_id: "char_beacon", name: "Beacon Foreman", location: "loc_beacon" },
    char_may: { character_id: "char_may", name: "May", central: true, location: "loc_house", background: "Works in benefits at Alder Span." },
  } as any;
  s.memory = {
    char_player: { episodic: [
      { content: "I emailed the team that Beacon Works is not my project.", full_content: "I emailed the team that Beacon Works is not my project." },
      { content: "I told Ellie I can't leave May.", full_content: "I told Ellie I can't leave May. Then I went up to look at the Beacon sheets." },
    ], facts: [{ content: "Ellie believes the Beacon feeder number is low." }, { content: "May likes tacos." }], core: [] },
    char_ellie: { episodic: [{ content: "Rabi said he wanted me but won't leave May.", where: "Seattle Municipal Tower" }], facts: [], core: ["I am the only one who checks the Beacon numbers.", "I need the lake."] },
    char_andre: { episodic: [{ content: "I taped tags in the basement.", where: "Beacon Works" }], facts: [] },
  } as any;
  s.minds = { char_ellie: { beliefs: [{ claim: "Beacon Works will fail inspection.", held_false: false }, { claim: "Rabi wants me.", held_false: false }] } } as any;
  s.world.canon = ["Seattle City Light runs electric service for the city.", "Beacon Works is a 2 MW industrial site."];
  s.world.threads = [{ id: "t1", title: "The Beacon Works load review", tension: 6 }, { id: "t2", title: "Ellie and Rabi in the garage", tension: 7 }] as any;
  s.world.rumors = [{ id: "r1", content: "Rabi dumped Ellie's Beacon files.", holders: ["char_ellie"] }, { id: "r2", content: "May and Rabi argue about money.", holders: [] }] as any;
  s.world.consequences = [{ id: "c1", description: "Dana asks where the Beacon file went.", due_turn: 58 }] as any;
  (s.world as any).offstage_log = [{ turn: 50, who: "char_andre", what: "Andre walks the basement.", place: "loc_beacon" }, { turn: 51, who: "char_may", what: "May files benefits forms.", place: "loc_house" }];
  s.world.edges = [{ from: "char_ellie", to: "char_player", warmth: 30, note: "Wants him. Keeps bringing him Beacon work." }, { from: "char_andre", to: "char_beacon", warmth: 5 }] as any;
  s.world.present = ["char_ellie"];
  s.history = [
    { turn: 50, player_action: "I toss the Beacon paperwork and go back to work", narrator_prose: `You drop the Beacon sheets in the bin.\n\n"That's the only file she's got," he says. Ellie's cardigan lies on the carpet.`, summary: "Rabi threw out the Beacon Works paperwork.", offscreen: ["Andre works toward Beacon Works labels", "May reviews forms."], shifts: [] },
    { turn: 51, player_action: "I head home", narrator_prose: "Ellie looks up. \"The Beacon number is still wrong,\" she says. \"Fine. Go.\"", summary: "Rabi left.", offscreen: [], shifts: [] },
    { turn: 52, player_action: "Beacon Beacon Beacon", narrator_prose: "The Beacon Works file is gone.", summary: "Beacon.", offscreen: [], shifts: [] },
  ] as any;
  s.chapters = [{ idx: 1, from_turn: 1, to_turn: 50, title: "Municipal Realities", summary: "Rabi managed the Beacon Works review. He told Ellie he can't leave May." }] as any;
  (s as any).context_anchor = { turn: 50, digest: "Ellie wants the Beacon number checked." };
  (s as any).last_stock = { phrase: "x", sentence: "the Beacon sheets" };
  return s;
}

check("terms are cleaned", JSON.stringify(nukeTerms("Beacon Works, Beacon, , ok")) === JSON.stringify(["Beacon Works", "Beacon"]));
const re = termRegex(["Beacon"])!;
check("a term is a whole word", re.test("the Beacon sheets") && re.test("Beacon's file") && !re.test("Beaconsfield") && !re.test("lighthouse-beacons"));
check("sentences are cut, not paragraphs", cutSentences("Ellie swims. The Beacon number is wrong. She goes home.", re) === "Ellie swims. She goes home.");

const s0 = world();
const plan = planNuke(s0, "Beacon Works, Beacon");
check("the preview changes nothing", s0.world.places.loc_beacon?.name === "Beacon Works" && !!s0.characters.char_ellie.current_goal?.includes("Beacon"));
check("and says what would go", plan.places[0] === "Beacon Works" && plan.removed.includes("Beacon Foreman") && (plan.counts.memories ?? 0) >= 3 && plan.turns.length === 3, plan);
const people = nukeCandidates(s0, "Beacon Works, Beacon");
check("the picker lists who it touches", people.some((p) => p.name === "Ellie Navarro" && !p.named) && people.some((p) => p.name === "Andre Sol") && people.some((p) => p.name === "Beacon Foreman" && p.named) && !people.some((p) => p.name === "May"), people);

const s = world();
const rep = nukeStoryline(s, "Beacon Works, Beacon");
const left: string[] = [];
const walk = (o: any, path: string) => {
  if (typeof o === "string") { if (/beacon/i.test(o) && !/^\.(retcons|world\.nuked)/.test(path)) left.push(`${path}: ${o}`); }
  else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
};
walk(s, "");
check("nothing in the save mentions it any more", left.length === 0, left);
check("its place is gone, and nobody is left standing in it", !s.world.places.loc_beacon && s.characters.char_andre.location !== "loc_beacon" && !s.travel_log!.some((t) => t.place === "loc_beacon"));
check("a person named by it is gone", !s.characters.char_beacon && !s.world.edges.some((e) => e.to === "char_beacon"));
check("the people stay", !!s.characters.char_ellie && !!s.characters.char_andre && !!s.characters.char_may);
check("a want about it is dropped and the next one in line takes over", s.characters.char_ellie.drive?.goal === "Get Rabi to notice her.", s.characters.char_ellie.drive);
check("a want with nothing behind it goes, so the engine forges a new one", !s.characters.char_andre.drive && !(s.characters.char_andre as any).drive_refreshed_time);
check("a goal about it goes", s.characters.char_ellie.current_goal === undefined);
check("background loses the sentence, keeps the person", s.characters.char_ellie.background === "Grew up in Tacoma. She swims at Seward Park.", s.characters.char_ellie.background);
check("voice lines and schedule blocks about it go", JSON.stringify(s.characters.char_ellie.voice?.example_lines) === JSON.stringify(["I need the lake."]) && s.characters.char_ellie.schedule!.blocks.length === 1);
check("the player's own want for her is untouched", (s.characters.char_ellie as any).authored?.want === "Get Rabi to cheat on May.");
check("the player's own notes lose it", (s.characters.char_player as any).self_stated.length === 1);
check("a memory about it goes", !s.memory.char_player.episodic.some((m: any) => /emailed the team/.test(m.content)));
check("a memory that only mentions it in passing stays, minus that sentence", s.memory.char_player.episodic.some((m: any) => m.content === "I told Ellie I can't leave May." && m.full_content === "I told Ellie I can't leave May."));
check("facts and core memories about it go, the rest stay", s.memory.char_player.facts!.length === 1 && JSON.stringify(s.memory.char_ellie.core) === JSON.stringify(["I need the lake."]));
check("a memory of something that happened at the deleted place goes", s.memory.char_andre.episodic.length === 0);
check("beliefs about it go", (s.minds as any).char_ellie.beliefs.length === 1);
check("canon, threads, rumours, consequences and the offstage log lose it", s.world.canon.length === 1 && s.world.threads.length === 1 && s.world.rumors.length === 1 && s.world.consequences.length === 0 && (s.world as any).offstage_log.length === 1);
check("a relationship survives, minus its note about it", s.world.edges.length === 1 && (s.world.edges[0] as any).note === "Wants him." && (s.world.edges[0] as any).warmth === 30, s.world.edges);
check("past turns stay, minus the sentences", s.history.length === 3 && s.history[0].narrator_prose.includes("Ellie's cardigan") && !/Beacon/.test(s.history[0].narrator_prose), s.history[0].narrator_prose);
check("a quoted line that mentions it goes whole, with no stranded quote marks", ((s.history[1].narrator_prose.match(/"/g) ?? []).length % 2) === 0, s.history[1].narrator_prose);
check("a turn emptied of text keeps a placeholder", s.history[2].narrator_prose === "…" && s.history[2].player_action === "…");
check("the chapter summary is cut, not dropped", s.chapters!.length === 1 && s.chapters![0].summary === "He told Ellie he can't leave May.", s.chapters);
check("the cached digest is dropped so it's rebuilt", !(s as any).context_anchor);
check("a correction quoting it is cleared", (s as any).last_stock === null);
check("the world bible loses the sentence", s.world_bible.political_situation === "City Light is short-staffed.");
check("place descriptions lose it", (s.world.places.loc_tower as any).description_facts === "A glass tower.");
check("it's recorded as a veto and for the guard", s.retcons!.some((r) => r.kind === "veto" && /Beacon Works/.test(r.text)) && !!s.world.nuked?.[0].terms.includes("Beacon"));
check("the report names what went", rep.places[0] === "Beacon Works" && rep.removed[0] === "Beacon Foreman" && rep.trimmed.some((t) => t.name === "Ellie Navarro"));

const s2 = world();
nukeStoryline(s2, "Beacon Works", { removePeople: ["char_andre"] });
check("a person the player picks goes too, with what's said about them", !s2.characters.char_andre && !s2.memory.char_andre && !(s2.history[0].offscreen as string[]).some((o) => /Andre/.test(o)));
check("the player can't be picked", !!nukeStoryline(world(), "Beacon", { removePeople: ["char_player"] }) && true);

const g = guardNuked(s, `Ellie sets her bag down. "Did you see the Beacon email?" she asks. May texts you.`, "I check my phone");
check("new narration that brings it back is cut", g.cut >= 1 && !/Beacon/.test(g.prose) && /May texts you/.test(g.prose), g);
check("unless the player brought it up", guardNuked(s, "The Beacon file is open.", "I open the Beacon file").cut === 0);
check("and a turn is never emptied", guardNuked(s, "The Beacon file is open.", "I look").prose === "The Beacon file is open.");

const sug = nukeSuggestions(world(), "Beacon Works, Beacon");
check("suggestions never repeat the terms or name the cast", !sug.some((w) => /beacon|ellie|andre|rabi/i.test(w)), sug);

const turn = readFileSync("src/engine/turn.ts", "utf8");
check("the turn guards against it", /guardNuked\(state, prose, action\)/.test(turn) && /noteFire\(state, "nuked"/.test(turn));
const api = readFileSync("src/lib/api.ts", "utf8");
check("the wipe keeps a recovery row and cleans the rollback points", /nuke: async[\s\S]{0,400}putSideRow\(id, "recovery", s\)[\s\S]{0,300}mapSnapshots\(s,/.test(api));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
