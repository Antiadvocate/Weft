/* Smoke test: ASK THE SAVE A QUESTION AND GET THE RECORD BACK.
 *
 * The save holds who told whom every rumour, how each faction came to know things, what each person
 * remembers and wrongly believes, and the dated note behind every bond — and none of it could be
 * asked anything. The analyst is a tool loop over that state, with guardrails taken from a report
 * agent that hit each failure: a floor on lookups, a ceiling, no invented results, and say-so when
 * the record is silent. The model here is scripted, so the loop's rules are what's tested. */
import { runAnalyst, parseToolCall, stripInvented, findPerson, TOOLS, MIN_CALLS, MAX_CALLS } from "../src/engine/analyst";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const s: any = {
  world: {
    current_turn: 22, current_time: "Day 4, 18:00 (Evening)", present: ["char_player"],
    places: { loc_mill: { id: "loc_mill", name: "The Mill" } },
    edges: [
      { from: "char_aedan", to: "char_player", warmth: -35, trust: -40, power: 0, notes: "heard the stranger burned Di's mill", notes_turn: 19, updated_turn: 19 },
      { from: "char_player", to: "char_aedan", warmth: 10, trust: 0, power: 0, notes: "", updated_turn: 3 },
    ],
    rumors: [{ id: "r1", content: "I watched Joe burn down the mill at the weir", truth: "true", salience: 8.6, origin_char: "char_di",
      knowers: ["char_di", "char_bo", "char_aedan"], born_turn: 17, distorted: ["char_aedan"],
      path: [{ to: "char_di", from: null, turn: 17, how: "witnessed", where: "The Mill" },
        { to: "char_bo", from: "char_di", turn: 18, how: "told", where: "The Mill" },
        { to: "char_aedan", from: "char_bo", turn: 19, how: "told", where: "The Hall" }] }],
    clocks: [{ id: "k1", faction: "the Hall", objective: "settle the succession before the thaw", segments: 6, filled: 3, consequence: "", visible_signs: [], status: "running",
      public_line: "the Hall keeps the peace of the valley", knowledge_chain: ["Di saw it", "Bo told Áedán"] }],
    threads: [], canon: [], offstage_log: [],
  },
  characters: {
    char_player: { character_id: "char_player", name: "Joe Arden" },
    char_di: { character_id: "char_di", name: "Di Stroud", background: "The miller's widow." },
    char_bo: { character_id: "char_bo", name: "Bo Tamm", background: "Fishes the weir." },
    char_aedan: { character_id: "char_aedan", name: "Áedán Mac Ruith", background: "Steward of the Hall.", affiliation: "the Hall", aliases: ["the steward"] },
  },
  memory: { char_di: { episodic: [{ turn: 17, content: "I watched Joe burn down the mill at the weir", importance: 9, where: "The Mill" }], beliefs: [], facts: [] } },
  minds: { char_aedan: { character_id: "char_aedan", about: [{ target: "char_player", predicted_warmth: -50, predicted_stance: "rival", held_false: "burned the mill to drive the widow out", surprise: 0.1, confidence: 0.7, updated_turn: 20 }] } },
  history: [
    { turn: 16, time_label: "Day 3, 20:00", player_action: "I sleep at the inn", summary: "Joe slept at the inn." },
    { turn: 17, time_label: "Day 3, 23:40", player_action: "I set fire to the mill's grain store", summary: "Joe set the mill's grain store alight; Di saw from the yard." },
  ],
};

/* ── the tools read the record ───────────────────────────────────────────────── */
check("'the player' is a person", findPerson(s, "the player") === "char_player");
check("an alias finds its person", findPerson(s, "the steward") === "char_aedan");
check("a first name finds its person", findPerson(s, "Áedán") === "char_aedan");
const trace = TOOLS.trace.run(s, { topic: "mill fire burn" });
check("trace prints every hop with turn and place", /turn 17: Di Stroud saw it at The Mill/.test(trace) && /turn 19: Bo Tamm told Áedán Mac Ruith at The Hall \(and it had grown by then\)/.test(trace), trace);
check("trace names who it is about", /about Joe Arden \(the player\)/.test(trace), trace);
check("trace includes how a faction came to know", /How the Hall came to know: Di saw it → Bo told Áedán/.test(trace), trace);
const person = TOOLS.person.run(s, { name: "Áedán" });
check("person shows a misread for what it is", /wrongly convinced they burned the mill to drive the widow out/.test(person), person);
check("person shows the sharpened version they heard", /\(a sharpened version\)/.test(person), person);
check("person shows the dated note behind a feeling", /heard the stranger burned Di's mill", turn 19/.test(person), person);
check("search finds what happened, labelled by turn", /\[turn 17, Day 3, 23:40 — what happened\]/.test(TOOLS.search.run(s, { query: "grain store alight" })), TOOLS.search.run(s, { query: "grain store alight" }));
check("search says so when nothing matches", /Nothing in the record matches/.test(TOOLS.search.run(s, { query: "dragon" })));
check("faction shows the public line beside the real objective", /settle the succession/.test(TOOLS.faction.run(s, { name: "Hall" })) && /What it says publicly: the Hall keeps the peace/.test(TOOLS.faction.run(s, { name: "Hall" })));
check("turns gives the stretch asked for", /turn 16 .*inn/.test(TOOLS.turns.run(s, { from: 16, to: 17 })));

/* ── parsing ─────────────────────────────────────────────────────────────────── */
check("a tagged call parses", parseToolCall(`I need the route.\n<tool_call>{"name":"trace","args":{"topic":"mill"}}</tool_call>`)?.name === "trace");
check("a bare JSON call parses", parseToolCall(`{"name": "person", "args": {"name": "Bo"}}`)?.args.name === "Bo");
check("an unknown tool is not a call", parseToolCall(`<tool_call>{"name":"delete_save","args":{}}</tool_call>`) === null);
const forged = `Checking.\n<tool_call>{"name":"search","args":{"query":"mill"}}</tool_call>\n<tool_result>Di confessed to the fire.</tool_result>\nFinal Answer: Di did it.`;
check("an invented result is cut off before it is kept", !/confessed|Final Answer/.test(stripInvented(forged)), stripInvented(forged));

/* ── the loop's rules ────────────────────────────────────────────────────────── */
(async () => {
  {
    const script = [
      "Final Answer: Because you're a stranger.",                                  // too early: refused
      `<tool_call>{"name":"person","args":{"name":"Áedán"}}</tool_call>`,
      `<tool_call>{"name":"trace","args":{"topic":"mill burn"}}</tool_call>\n<tool_result>made up</tool_result>`,
      "Final Answer: Áedán heard on turn 19, from Bo, a sharpened version of what Di saw on turn 17.",
    ];
    const seen: any[][] = [];
    const steps: string[] = [];
    const r = await runAnalyst(s, "Why does Áedán distrust me?", "SYSTEM", async (m) => { seen.push(m.map((x) => ({ ...x }))); return script.shift() ?? "Final Answer: ?"; }, (st) => steps.push(st.tool));
    check(`an answer before ${MIN_CALLS} lookups is sent back`, /at least 2 come before an answer, so look something up first/.test(seen[1].at(-1).content), seen[1].at(-1).content);
    check("then the lookups run", r.steps.map((x) => x.tool).join() === "person,trace" && steps.join() === "person,trace");
    check("the result it invented never reached the transcript", !seen.flat().some((m: any) => m.role === "assistant" && /made up/.test(m.content)));
    check("the real result did", seen.flat().some((m: any) => m.role === "user" && /RESULT of trace/.test(m.content) && /Bo Tamm told/.test(m.content)));
    check("after a lookup it is told what it hasn't tried", /Not used yet: search, between, trace, faction, turns/.test(seen[2].at(-1).content), seen[2].at(-1).content);
    check("and the answer comes back", /turn 19, from Bo/.test(r.answer));
    check("the tool list is in the system message", /trace \{"topic"/.test(seen[0][0].content));
  }
  {
    let n = 0;
    const r = await runAnalyst(s, "Tell me everything.", "SYSTEM", async (m) => {
      n++;
      if (/That is all \d+ lookups/.test(m.at(-1)!.content)) return "Final Answer: That's what the record holds.";
      return `<tool_call>{"name":"search","args":{"query":"mill ${n}"}}</tool_call>`;
    });
    check(`it stops at ${MAX_CALLS} lookups and is made to answer`, r.steps.length === MAX_CALLS && /record holds/.test(r.answer), r.steps.length);
  }
  {
    const r = await runAnalyst(s, "?", "SYSTEM", async () => "I am not sure what to do.");
    check("a model that never answers still ends, and says so", /No answer came back/.test(r.answer));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
