
/**
 * EXTRACT — regex-first bookkeeping. Zero tokens.
 *
 * A large share of the Simulator's job is mechanical transcription of highly patterned
 * prose: movement, hand-offs, conditions subsiding, time cues. A deterministic extractor
 * catches these for free. It runs as BACKFILL: the LLM diff always wins on any key it
 * populated; heuristics only fill what the LLM missed (or everything, when the diff came
 * back unusable — turning the old "silent amnesia" turn into a "basics still recorded" turn).
 *
 * Conservatism is the design rule here: every pattern is second-person or names a known
 * character, and anything ambiguous is left for the LLM. A wrong deterministic write is
 * worse than a missing one.
 */
import type { SaveState, SimulatorDiff } from "./types";

/** Names come from the simulator and can contain anything — "(unnamed taller woman)" is real
 *  save data. Everything interpolated into a RegExp gets escaped, no exceptions. */
const escRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The verbs and phrasings by which prose says someone left. Shared: extractHeuristics uses it to
 *  MOVE people out, and the phantom-exit clamp uses it to REFUSE moves the prose never described. */
export const DEPART_PATTERN = "(?:leaves|left|walks out|walked out|storms out|stormed out|departs|departed|slips away|slipped away|slips out|slipped out|heads out|headed out|steps out|stepped out|steps outside|excuses? (?:him|her|them)self|excused (?:him|her|them)self|ducks out|ducked out|disappears?(?: down| into| through| around)|disappeared(?: down| into| through| around)|vanishes?(?: down| into| through)|retreats?(?: to| into| down)|retreated|withdraws?|withdrew|exits?|exited|goes? (?:to|into|back to|off to)|went (?:to|into|back to|off to)|makes? (?:him|her|them)self scarce|is gone|was gone|were gone|has (?:already )?gone|had (?:already )?gone|is no longer (?:here|in the room|present)|are no longer (?:here|present)|takes? (?:his|her|their) leave|took (?:his|her|their) leave|shows? (?:him|her|them)self out|closes? the door behind (?:him|her|them)|shuts? the door behind (?:him|her|them))";

/** Did the prose actually say this person left? Exits must be written, never inferred. */
export function DEPART_IN_PROSE(prose: string, name?: string): boolean {
  if (!name) return false;
  const first = name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameFirst = new RegExp(`\\b${first}\\b[^.!?]{0,60}?\\b${DEPART_PATTERN}`, "i");
  const verbFirst = new RegExp(`\\b${DEPART_PATTERN}\\b[^.!?]{0,40}?\\b${first}\\b`, "i");
  return nameFirst.test(prose) || verbFirst.test(prose);
}

export interface HeuristicDiff {
  elapsed_minutes?: number;
  player_location?: string;
  locations: { char_id: string; place: string }[];
  facts: SimulatorDiff["facts"];
  memories: SimulatorDiff["memories"];
}

/** Map of lowercase first-names → char ids for the present cast (cheap named-entity resolution). */
function presentNameMap(state: SaveState): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of state.world.present) {
    const n = state.characters[id]?.name;
    if (!n) continue;
    m.set(n.toLowerCase(), id);
    m.set(n.split(/\s+/)[0].toLowerCase(), id);
  }
  return m;
}

const TIME_CUES: [RegExp, number][] = [
  [/\b(the next morning|by morning|come morning)\b/i, 8 * 60],
  [/\bhours (later|pass)\b/i, 150],
  [/\ban hour (later|passes)\b/i, 60],
  [/\bby (nightfall|evening|dusk)\b/i, 5 * 60],
  [/\bby dawn\b/i, 7 * 60],
  [/\bafter a long (day|night)\b/i, 8 * 60],
];

export function extractHeuristics(state: SaveState, action: string, prose: string): HeuristicDiff {
  const out: HeuristicDiff = { locations: [], facts: [], memories: [] };
  const text = prose;
  const names = presentNameMap(state);

  // ── elapsed time (largest cue wins; the LLM's estimate still overrides)
  for (const [re, mins] of TIME_CUES) if (re.test(text)) out.elapsed_minutes = Math.max(out.elapsed_minutes ?? 0, mins);

  // ── player movement: strictly second-person arrival phrasing with a capitalized destination
  const mv = /\b[Yy]ou (?:walk|head|step|go|climb|descend|make your way|push|slip|arrive)\s+(?:back\s+)?(?:in|out|up|down)?\s*(?:in)?to\s+(?:the\s+)?([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})(?=[,.;:!?\s])/;
  const mvm = mv.exec(text);
  if (mvm) out.player_location = mvm[1].trim();

  // ── inventory hand-offs (player side only — the unambiguous cases)
  const takes = [...text.matchAll(/\byou (?:take|pick up|pocket|grab|accept|catch|lift|retrieve)\s+(?:the|a|an|his|her|their)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const t of takes) out.facts!.push({ char_id: "char_player", field: "inventory_add", value: t[1].trim() });
  const gives = [...text.matchAll(/\b(?:hands?|passes|gives|tosses|offers)\s+you\s+(?:the|a|an|his|her|their)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const g of gives) out.facts!.push({ char_id: "char_player", field: "inventory_add", value: g[1].trim() });
  const drops = [...text.matchAll(/\byou (?:drop|set down|put down|hand (?:over|back)|toss aside|discard|leave behind)\s+(?:the|a|an|your)\s+([\w'’ -]{3,32}?)(?=[,.;:!?])/gi)];
  for (const d of drops) out.facts!.push({ char_id: "char_player", field: "inventory_remove", value: d[1].trim() });

  // ── conditions subsiding: "the bleeding stops", "X catches her breath"
  if (/\b(the\s+)?bleeding (stops|slows|has stopped)\b/i.test(text)) {
    for (const id of ["char_player", ...state.world.present]) {
      const c = state.condition[id];
      if (c?.conditions.some((x) => /bleed|blood/i.test(x))) out.facts!.push({ char_id: id, field: "condition_remove", value: "bleeding" });
    }
  }
  for (const [lower, id] of names) {
    const re = new RegExp(`\\b${escRe(lower)}\\b[^.!?]{0,40}\\bcatches (his|her|their) breath\\b`, "i");
    if (re.test(text)) {
      const c = state.condition[id];
      if (c?.conditions.some((x) => /winded|breathless|out of breath/i.test(x))) out.facts!.push({ char_id: id, field: "condition_remove", value: "winded" });
    }
  }

  // Movement is NOT inferred from prose here. Guessing exits from verb lists moved people who were
  // still speaking, and guessing arrivals moved people who were only mentioned. The narrator now
  // writes entrances and departures plainly and the simulator quotes the words that say so, with the
  // quote checked against the prose before the move is applied. A regex has no business deciding
  // who is in the room.

  // ── CLOTHING: this is the fix for "I put on my shirt and the sheet still says shirtless."
  // Models rarely emit wearing updates from casual phrasing, so the deterministic layer owns it.
  // First-person (the ACTION) and second-person (the prose) both count.
  const both = `${action}\n${prose}`;
  const wearOn = [...both.matchAll(/\b(?:I|[Yy]ou)\s+(?:put on|pull on|slip into|slips? on|shrug into|button up|dress in|throw on|tug on)\s+(?:the|my|your|a|an)\s+([\w'’ -]{3,32}?)(?=[,.;:!?\n])/g)];
  for (const w of wearOn) out.facts!.push({ char_id: "char_player", field: "wearing_add", value: w[1].trim() });
  const wearOff = [...both.matchAll(/\b(?:I|[Yy]ou)\s+(?:take off|pull off|strip off|shrug off|remove|peel off|unbutton and discard|step out of)\s+(?:the|my|your|a|an)\s+([\w'’ -]{3,32}?)(?=[,.;:!?\n])/g)];
  for (const w of wearOff) out.facts!.push({ char_id: "char_player", field: "wearing_remove", value: w[1].trim() });

  // ── PHYSIOLOGY refills: eating, drinking, sleeping (player side; conservative phrasing)
  if (/\b(?:I|[Yy]ou)\s+(?:eat|wolf(?: down)?|finish(?:es)? (?:the|a) (?:meal|plate|bowl)|devour)\b/.test(both) || /\b[Yy]ou (?:share|finish) (?:a|the) meal\b/.test(prose))
    out.facts!.push({ char_id: "char_player", field: "hunger", value: "fed" });
  if (/\b(?:I|[Yy]ou)\s+(?:drink|gulp|sip|drain (?:the|a) (?:cup|flask|glass|waterskin)|swallow (?:the )?water)\b/.test(both))
    out.facts!.push({ char_id: "char_player", field: "thirst", value: "quenched" });
  const slept = /\b(?:I|[Yy]ou)\s+(?:sleep|fall asleep|doze off|bed down)\b|\bwake (?:the next morning|at dawn|hours later)\b|\byou wake\b/i.test(both);
  if (slept) out.facts!.push({ char_id: "char_player", field: "slept", value: "7" });

  return out;
}

/** Merge heuristics UNDER the LLM diff: only keys/entries the model didn't already cover. */
export function backfillDiff(diff: SimulatorDiff, h: HeuristicDiff): SimulatorDiff {
  const d = { ...diff };
  if ((!d.elapsed_minutes || d.elapsed_minutes <= 0) && h.elapsed_minutes) d.elapsed_minutes = h.elapsed_minutes;
  if (!d.player_location && h.player_location) d.player_location = h.player_location;
  const movedIds = new Set((d.locations ?? []).map((l) => l.char_id));
  d.locations = [...(d.locations ?? []), ...h.locations.filter((l) => !movedIds.has(l.char_id))];
  const factKey = (f: { char_id: string; field: string; value: string }) => `${f.char_id}|${f.field}|${f.value.toLowerCase()}`;
  const seen = new Set((d.facts ?? []).map(factKey));
  d.facts = [...(d.facts ?? []), ...(h.facts ?? []).filter((f) => !seen.has(factKey(f)))];
  return d;
}

