/* Smoke test: THE BOOKKEEPER JUDGES THE PROSE.
 *
 * Every check on the narrator's output used to be a word list, and the owner's verdict on all of them
 * was one line: the models writing this prose are beyond being caught by word choice filters. So the
 * bookkeeper reports what's wrong with the turn as prose_check, quoting the narrator's own words, and
 * the engine does three things with it, all pinned here:
 *
 *   1. finds the quoted words on the page, forgiving how a model copies text back, and cuts them
 *      without stranding a quotation mark;
 *   2. holds the findings to the words actually written, so a finding that quotes something the
 *      narrator never wrote accuses nobody and cuts nothing;
 *   3. turns the style findings into next turn's corrections, on the instance or on recurrence, by
 *      the same rules the old detectors used.
 *
 * And the whole turn: a flagged line put in the player's mouth never reaches the committed history. */
import { trimToStory, locate, contains, cutSentences, cutSpans, dropLastParagraph, shapeCheck, shapeDialogue, settingCuts, feedForward, hasFindings, EMPTY_CHECK, figureFrom, narratedBackFrom, stockFrom } from "../src/engine/prosecheck";
import { newSave, registerCharacter } from "../src/engine/state";
import { runTurn } from "../src/engine/turn";
import { normalizeDiffArrays } from "../src/engine/coerce";
import type { ProseCheck, SaveState } from "../src/engine/types";

(globalThis as any).localStorage ??= {
  getItem: (k: string) => (k === "weft-openrouter-key" ? "sk-test-not-a-real-key" : null),
  setItem: () => {}, removeItem: () => {},
};
(globalThis as any).location ??= { origin: "http://localhost", href: "http://localhost/" };

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const withCheck = (p: Partial<ProseCheck>): ProseCheck => ({ ...EMPTY_CHECK, ...p });

function world(): SaveState {
  const s = newSave("prose", {
    name: "The Narrow House", genre: "domestic", tone: "close",
    difficulty_profile: { lethality: "medium", friction_density: "balanced", antagonist_aggression: "active", protagonist_competence: "average" },
  } as any);
  s.world.places["loc_flat"] = { id: "loc_flat", name: "The Flat", description_facts: "Two rooms over a bakery.", contains: [] } as any;
  s.world.player_location = "loc_flat";
  registerCharacter(s, { name: "Rabi", character_id: "char_player", pronouns: "he/him", location: "loc_flat" } as any);
  registerCharacter(s, { name: "Tessa Marr", character_id: "char_tessa", pronouns: "she/her", location: "loc_flat" } as any);
  registerCharacter(s, { name: "Old Corwin", character_id: "char_corwin", pronouns: "he/him" } as any);
  s.characters["char_corwin"].status = "dead";
  s.world.present = ["char_tessa"];
  s.world.current_turn = 5;
  return s;
}

/* ── 1. finding the words on the page ─────────────────────────────────────────── */
{
  const prose = "Tessa sets the cup down. “You’re not wrong,” she says.\n\nThe kettle   ticks.";
  check("straight quotes find curly ones", contains(prose, `"You're not wrong," she says.`));
  check("runs of whitespace fold to one", contains(prose, "The kettle ticks."));
  check("case doesn't matter", contains(prose, "TESSA SETS THE CUP DOWN"));
  check("words that aren't there aren't found", !contains(prose, "Tessa throws the cup"));
  const at = locate(prose, "the kettle ticks");
  check("and the span lands on the original text", !!at && prose.slice(at![0], at![1]) === "The kettle   ticks", at && prose.slice(at[0], at[1]));
  check("a span too short to mean anything is never found", locate(prose, "a") === null);
}

/* ── 2. cutting ───────────────────────────────────────────────────────────────── */
{
  const prose = `Tessa looks at you. "So you'll stay," you say, and she laughs. She goes to the window.\n\n"Fine," she says.`;
  const r = cutSentences(prose, [`"So you'll stay," you say`]);
  check("the whole sentence holding the line goes", !r.prose.includes("stay") && !r.prose.includes("she laughs"), r.prose);
  check("its neighbours stay", r.prose.includes("Tessa looks at you.") && r.prose.includes("She goes to the window."), r.prose);
  check("and what was cut is reported", r.cut.length === 1 && r.cut[0].includes("So you'll stay"), r.cut);
  check("no quotation mark is stranded", [...r.prose].filter((c) => c === '"').length % 2 === 0, r.prose);

  const lone = cutSentences(`One line.\n\nGone entirely.`, ["Gone entirely."]);
  check("a paragraph emptied entirely goes", lone.prose === "One line.", JSON.stringify(lone.prose));

  const capped = cutSentences("A one. B two. C three.", ["A one.", "B two.", "C three."], 1);
  check("the cap holds", capped.cut.length === 1 && capped.prose === "B two. C three.", capped);

  const note = cutSpans(`(Note: keep the pressure on Tessa.)\n\nTessa waits.`, ["(Note: keep the pressure on Tessa.)"]);
  check("a note that was never story is cut exactly", note.prose === "Tessa waits.", JSON.stringify(note.prose));

  check("the last paragraph drops when two remain", dropLastParagraph("One.\n\nTwo.") === "One.");
  check("but a one-paragraph turn keeps it", dropLastParagraph("Only.") === "Only.");
}

/* ── 2b. the story inside a reply that holds more than the story ──────────────── */
{
  const scene = "Tessa sets the cup down and looks at you for a long moment before she speaks again, quietly.";
  const reply = `Okay, let me plan this. Tessa should be cautious here.\n\n${scene}\n\n(Word count: about 20. Tone: close.)`;
  const r = trimToStory(reply, "Tessa sets the cup down and", "before she speaks again, quietly.");
  check("the planning before the scene goes", r.cut && r.prose.startsWith("Tessa sets the cup"), r.prose);
  check("and the notes after it", !r.prose.includes("Word count"), r.prose);
  check("bounds that aren't on the page cut nothing", !trimToStory(reply, "Nobody wrote this at all", "").cut);
  check("a cut that would leave almost nothing is refused", !trimToStory(reply, "quietly.", "").cut);
}

/* ── 3. findings held to the words written and the people who exist ───────────── */
{
  const s = world();
  const prose = `Tessa turns. "You always do this," she says. Corwin walks in from the hall.`;
  const c = shapeCheck(s, {
    player_lines: [`"I love you," you say`],
    impossible: [{ who: "Old Corwin", sentence: "Corwin walks in from the hall.", why: "Corwin is dead" }],
    interior: ["She is afraid he'll leave."],
    body: [{ who: "char_tessa", part: "tail", sentence: "Tessa turns." }],
    overrun: "sideways",
  }, prose);
  check("a line the narrator never wrote is dropped", c.player_lines.length === 0, c.player_lines);
  check("a finding on the page stands", c.impossible.length === 1, c.impossible);
  check("and its who resolves from a name to an id", c.impossible[0]?.who === "char_corwin", c.impossible[0]);
  check("an interior claim that isn't on the page goes", c.interior.length === 0);
  check("a body part off the list is refused", c.body.length === 0, c.body);
  check("an unknown overrun reads as none", c.overrun === "none");
  check("a clean check stores nothing", !hasFindings(shapeCheck(s, {}, prose)));
  check("and this one is not clean", hasFindings(c));

  const d = shapeDialogue(s, [{ who: "Tessa Marr", line: "You always do this," }, { who: "char_tessa", line: "I never said that." }], prose);
  check("dialogue keeps the lines on the page", d.length === 1 && d[0].who === "char_tessa", d);
}

/* ── 4. setting: one free sentence is atmosphere ──────────────────────────────── */
{
  const setting = [
    { sentence: "Rain on the glass.", motif: "rain", alone: true },
    { sentence: "The radiator clanks.", motif: "radiator", alone: true },
    { sentence: "Wind at the door.", motif: "wind", alone: true },
    { sentence: "She shivers in the draught.", motif: "draught", alone: false },
  ];
  const cuts = settingCuts(setting, new Set());
  check("the first free-standing one stays", !cuts.includes("Rain on the glass."), cuts);
  check("the rest go", cuts.includes("The radiator clanks.") && cuts.includes("Wind at the door."), cuts);
  check("a sentence with somebody in it is never cut", !cuts.includes("She shivers in the draught."), cuts);
  const spent = settingCuts(setting, new Set(["rain"]));
  check("a motif last turn spent loses its allowance", spent.includes("Rain on the glass.") && !spent.includes("The radiator clanks."), spent);
}

/* ── 5. next turn's corrections ───────────────────────────────────────────────── */
{
  const s = world();
  const ff = feedForward(s, withCheck({
    interior: ["She wants him to stay.", "Tessa is hiding how much it hurts her, and always has."],
    sayings: ["Love is a debt nobody pays.", "Every house remembers."],
    impossible: [{ who: "char_corwin", sentence: "Corwin walks in.", why: "dead" }],
    walked_in: [{ who: "char_tessa", line: "Tessa is by the bed." }],
  }), [], { prose: "x", mode: "do", voided: false, complained: false, presentIds: ["char_tessa"], past: [] });
  check("the longest stated interior is held", s.last_leak?.startsWith("Tessa is hiding") === true, s.last_leak);
  check("the shortest saying is held", s.last_maxim === "Every house remembers.", s.last_maxim);
  check("the dead acting is quoted back", s.last_risen?.name === "Old Corwin" && s.last_risen?.status === "dead", s.last_risen);
  check("the walk-in names the place", s.last_intrusion?.place === "The Flat" && s.last_intrusion?.name === "Tessa Marr", s.last_intrusion);
  check("the player is told", ff.shifts.some((x) => x.includes("feeling or thinking 2 times")), ff.shifts);

  const quiet = world();
  feedForward(quiet, withCheck({}), [], { prose: "x", mode: "do", voided: false, complained: false, presentIds: [], past: [] });
  check("a clean turn clears every correction", quiet.last_leak === null && quiet.last_maxim === null && quiet.last_risen === null && quiet.last_pov === null);
}
{
  // recurrence: one comparison is a choice, three turns running is a habit
  const fig = withCheck({ figures: ["like she was weighing it"] });
  check("one turn of figures is nothing", figureFrom(fig, []) === null);
  check("three in five turns is a habit", figureFrom(fig, [{ faults: fig }, {}, { faults: fig }])?.runs === 3);
  // narrated back: two now, or one now and one in the two turns before
  const nb = withCheck({ narrated_back: ["You're standing there like you want me to say it."] });
  check("one line alone waits", narratedBackFrom(nb, [], false) === null);
  check("one now and one before fires", narratedBackFrom(nb, [{ faults: nb }], false)?.lines.length === 2);
  check("the player saying so fires on its own", narratedBackFrom(withCheck({}), [], true)?.complained === true);
  // stock: twice in a turn, or the same phrase coming back
  const st = withCheck({ stock: [{ phrase: "a beat too long", sentence: "She held his gaze a beat too long." }] });
  check("one stock phrase is the cost of prose", stockFrom(st, []) === null);
  check("the same one coming back is quoted", stockFrom(st, [{ faults: st }])?.phrase === "a beat too long");
}
{
  // never_says, against what the bookkeeper heard each person say
  const s = world();
  (s.characters["char_tessa"] as any).voice = { never_says: ["I don't know", "that's your business"] };
  feedForward(s, withCheck({}), [{ who: "char_tessa", line: "Well, that's your business, isn't it." }], { prose: "x", mode: "do", voided: false, complained: false, presentIds: ["char_tessa"], past: [] });
  check("a line off the card is caught", s.last_never_said?.forbidden === "that's your business", s.last_never_said);
  feedForward(s, withCheck({}), [{ who: "char_player", line: "That's your business." }], { prose: "x", mode: "do", voided: false, complained: false, presentIds: ["char_tessa"], past: [] });
  check("the same words from someone else are theirs to say", s.last_never_said === null, s.last_never_said);
}
{
  // the player written from outside, and how much "you" there was against it
  const s = world();
  feedForward(s, withCheck({ player_third_person: ["Rabi crosses the room.", "He sits."] }), [], { prose: "Rabi crosses the room. He sits. You hear the rain.", mode: "do", voided: false, complained: false, presentIds: [], past: [] });
  check("two sentences written from outside fire", s.last_pov?.third === 2, s.last_pov);
  check("and the second person is counted on the page", s.last_pov?.second === 1, s.last_pov);
}

/* ── 5b. the diff's single-object fields stay objects ──────────────────────────
 * normalizeDiffArrays wrapped every object in a list, so prose_check, the bible update and the
 * unexplained sighting all arrived as one-element arrays that nothing could read. */
{
  const d: any = normalizeDiffArrays({ prose_check: { overrun: "cascade" }, bible_update: { magic_rules: "x" }, unexplained: { what: "y" }, memories: { char_id: "a", content: "b" } });
  check("prose_check stays an object", !Array.isArray(d.prose_check) && d.prose_check.overrun === "cascade", d.prose_check);
  check("so does the bible update", !Array.isArray(d.bible_update) && d.bible_update.magic_rules === "x", d.bible_update);
  check("and the unexplained sighting", !Array.isArray(d.unexplained) && d.unexplained.what === "y", d.unexplained);
  check("a list field given one object is still a list of one", Array.isArray(d.memories) && d.memories.length === 1);
  const back: any = normalizeDiffArrays({ prose_check: [{ refused: true }] });
  check("and an object sent inside a list is taken back out", back.prose_check?.refused === true, back.prose_check);
}

/* ── 6. the whole turn: what the bookkeeper flags never reaches the record ────── */
{
  const s = world();
  const prose = [
    `Tessa looks up from the sink. "You came back," she says.`,
    `"I couldn't stay away," you tell her, and you mean it.`,
    `(Next turn: escalate the landlord thread.)`,
    `She dries her hands and says nothing for a while.`,
    `<<<SCENE place="The Flat" here="Tessa Marr" entered="" left="" new="" alias="">>>`,
  ].join("\n\n");
  const diff = {
    scene_summary: "Tessa Marr greeted Rabi at the sink.",
    elapsed_minutes: 5,
    dialogue: [{ who: "char_tessa", line: "You came back," }, { who: "char_player", line: "I couldn't stay away," }],
    prose_check: {
      player_lines: ["I couldn't stay away,"],
      not_story: ["(Next turn: escalate the landlord thread.)"],
      interior: [],
    },
  };
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init: any) => {
    const body = String(init?.body ?? "");
    const content = body.includes("weft_diff") ? JSON.stringify(diff) : "{}";
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: {} }), text: async () => content } as any;
  }) as any;
  const shifts: string[] = [];
  try {
    await runTurn(s, "I come in from the rain.", { onPhase: () => {}, onDelta: () => {}, onMeta: (m: any) => { if (Array.isArray(m?.shifts)) shifts.push(...m.shifts); } } as any, "do", { proseOverride: prose });
  } catch (e) { console.log("turn threw", e); }
  globalThis.fetch = real;
  const h = s.history.at(-1);
  check("the turn was recorded", !!h && h.turn === 5, h?.turn);
  check("the line put in the player's mouth is gone from the record", !!h && !h.narrator_prose.includes("couldn't stay away"), h?.narrator_prose);
  check("so is the narrator's note to itself", !!h && !h.narrator_prose.includes("escalate the landlord"), h?.narrator_prose);
  check("the rest of the scene stands", !!h && h.narrator_prose.includes("You came back") && h.narrator_prose.includes("dries her hands"), h?.narrator_prose);
  check("the player is told about the line", shifts.some((x) => x.includes("you never typed")), shifts);
  check("and it is quoted back next turn", s.last_voiced?.line === "I couldn't stay away,", s.last_voiced);
  check("the findings are kept on the entry", (h?.faults?.player_lines ?? []).length === 1, h?.faults);
  check("the dialogue left on the page is kept, the cut line is not", (h?.dialogue ?? []).length === 1 && h?.dialogue?.[0].who === "char_tessa", h?.dialogue);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
