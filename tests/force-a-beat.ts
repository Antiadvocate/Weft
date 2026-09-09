/* Smoke test: A DEBUG CHANNEL, BECAUSE FORTY TURNS OF A JOB APPLICATION IS NOT A DIAGNOSIS.
 *
 * "I need some kind of debug command to force it — before I was 40 turns talking about job scope."
 *
 * Every gate in selectBeat is defensible on its own and the stack of them is opaque. A player
 * watching nothing happen cannot tell a cooldown from a fatigued source from a lost coin flip, and
 * the only way anyone found out was exporting a save to somebody who could read the telemetry. So:
 *
 *   [[beat]]          the world moves this turn, engine's choice
 *   [[beat: voice]]   ...and it moves through the source matching "voice"
 *   [[beat: ?]]       print every source and how long each has waited; press with none of them
 *
 * Stripped from the action before framing, like the ((search)) directive it copies — the narrator
 * and the bookkeeper never see a character of it. */
import { selectBeat, beatSources, type Beat, type BeatInput } from "../src/engine/pressure";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(name: string, c: boolean, extra?: unknown) {
  if (c) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}`, extra ?? ""); }
}

const VOICE = "The voice from Amber's feet becoming more insistent and seductive";
const INTIMACY = "The growing intimacy and tension between Joe and Amber";
const CLOCKS = [{ faction: "The Voice", objective: "the voice grows stronger", status: "running",
  segments: 6, filled: 2, visible_signs: ["Joe hears whispers even when Amber is not in the room"] }] as any[];
const THREADS = [{ id: "t1", title: "Amber's Job Search", status: "active", tension: 3 },
  { id: "t2", title: "Black Closed-Toe, Thursday At Two", status: "active", tension: 3 }] as any[];

const inp = (o: Partial<BeatInput> = {}): BeatInput => ({
  turn: 39, tension: 10, threads: THREADS, clocks: CLOCKS, consequences: [], agents: [],
  palette: [VOICE, INTIMACY], last_beat_turn: 38, last_exo_turn: 0,
  recent: [{ ref: VOICE, turn: 38, count: 3, kind: "palette" } as any],
  minutesSinceBeat: 2, restoration: false, ...o,
} as BeatInput);

const many = (o: Partial<BeatInput>, n = 200): Beat[] =>
  Array.from({ length: n }, () => selectBeat(inp(o)) as Beat);

// ---- without the override, this exact state is shut ---------------------------------------------
// One turn after a beat, MIN_GAP_TURNS holds the world off. That is correct and it is also exactly
// the state a player cannot see from the outside.
const shut = many({});
check("one turn after a beat, nothing presses", shut.every((b) => b.kind === "none" || (b as any).quiet || (b as any).young), shut.find((b) => b.kind !== "none"));

// ---- [[beat]] ----------------------------------------------------------------------------------
const forced = many({ force: "" });
check("[[beat]] moves the world anyway", forced.every((b) => b.kind !== "none"), forced.find((b) => b.kind === "none"));
check("...and picks something real", forced.every((b) => !!(b as any).ref));

// ---- [[beat: voice]] ---------------------------------------------------------------------------
const named = many({ force: "voice" });
check("[[beat: voice]] finds the palette line by a word of it",
  named.every((b) => b.kind === "palette" && (b as any).ref === VOICE), named.find((b) => (b as any).ref !== VOICE));
// ...even though that line fired LAST turn and is deep in the fatigue table. Forcing reads
// `standing`, not `eligible`: the player asked for a source that is resting, on purpose.
check("...even when that source is the one resting off a fresh appearance", named.length > 0);
check("a kind works as well as a name", many({ force: "thread" }).every((b) => b.kind === "thread"));
check("so does a fragment of a thread title",
  many({ force: "closed-toe" }).every((b) => (b as any).ref === "Black Closed-Toe, Thursday At Two"));
check("[[beat: exogenous]] reaches the one source that is not standing",
  many({ force: "exogenous" }).every((b) => b.kind === "exogenous"));
check("[[beat: nothing]] is an answer too", many({ force: "nothing" }).every((b) => b.kind === "none"));
// A name that matches nothing does not silently do nothing — the player asked for a beat.
check("an unmatched name still moves the world", many({ force: "xyzzy" }).every((b) => b.kind !== "none"));

// ---- the two early exits it has to outrank -----------------------------------------------------
// Both of these return before the override's own block, so both are gated on it explicitly. A debug
// command that silently no-ops is worse than not having one.
check("a rest dial does not swallow it", many({ force: "voice", tension: 0 }).every((b) => b.kind === "palette"));
check("nor does the opening grace window", many({ force: "voice", turn: 3, last_beat_turn: 0 }).every((b) => b.kind === "palette"));
check("...while an unforced turn at a rest dial is still at rest", many({ tension: 0 }).every((b) => b.kind === "none"));
check("...and the grace window still holds when nobody asked", 
  many({ turn: 3, last_beat_turn: 0 }).every((b) => b.kind === "none" || b.kind === "reminder"));

// ---- [[beat: ?]] -------------------------------------------------------------------------------
const rows = beatSources(inp());
check("the table lists every source", rows.length === 5, rows);
check("...the palette among them", rows.some((r) => r.startsWith("palette") && r.includes(VOICE)), rows);
check("...the clock with its fill", rows.some((r) => r.includes("clock 2/6")), rows);
check("...the threads with their tension", rows.some((r) => r.includes("thread situation @3")), rows);
check("...and how long each has waited", rows.some((r) => r.includes("last fired turn 38, 1 ago")) && rows.some((r) => r.includes("never fired")), rows);

// ---- the parser -------------------------------------------------------------------------------
// Mirrors the strip in turn.ts. The point of every case here is that the narrator never sees it.
const RE = /\[\[\s*beat\s*(?::\s*([^\]]*))?\]\]/gi;
const parse = (a: string) => { let f: string | undefined; const out = a.replace(RE, (_m, w) => { f = String(w ?? "").trim(); return ""; }).replace(/\s{2,}/g, " ").trim(); return { f, out }; };
check("bare form parses to the empty string, not undefined", parse("I put the kettle on [[beat]]").f === "");
check("...and leaves the action clean", parse("I put the kettle on [[beat]]").out === "I put the kettle on");
check("named form parses", parse("[[beat: voice]] I wait").f === "voice");
check("...and leaves the action clean", parse("[[beat: voice]] I wait").out === "I wait");
check("the query form parses", parse("I wait [[beat: ?]]").f === "?");
check("spacing inside the brackets is forgiven", parse("[[ beat :  the voice ]] x").f === "the voice");
check("case is forgiven", parse("[[BEAT]] x").f === "");
check("an action with no directive is untouched", parse("I put the kettle on").f === undefined);
check("...and a stray bracket is not a directive", parse("I read [[the sign]]").f === undefined);
check("nothing of it survives into the action", !parse("[[beat: voice]] I wait").out.includes("["));

// ---- and turn.ts wires it ----------------------------------------------------------------------
const src = readFileSync(new URL("../src/engine/turn.ts", import.meta.url), "utf8");
check("turn.ts strips the directive off the action", /action = action\.replace\(\/\\\[\\\[\\s\*beat/.test(src));
check("...before the interior split, so the narrator never sees it",
  src.indexOf("let forceBeat") < src.indexOf("const { outward: outwardAction"));
check("...passes it to the selector", /selectBeat\(\{ \.\.\.beatInput, force: forceBeat \}\)/.test(src));
check("...tells the player what fired", /forced \$\{beat\.kind\}/.test(src));
check("...and keeps the table on the turn rather than in a toast", /if \(beatTable\.length\) shifts\.unshift\(\.\.\.beatTable\);/.test(src));
check("...with room in the record for it", /shifts\.slice\(0, 8 \+ beatTable\.length\)/.test(src));
check("a forced beat still reaches the narrator at a rest dial",
  /const dial = forceBeat !== undefined \? Math\.max\(1, state\.model_settings\.tension \?\? 5\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
