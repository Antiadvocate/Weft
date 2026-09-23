/**
 * THE COHERENCE GATE — the one check that runs BEFORE a turn is allowed to exist.
 *
 * A player, after a long session of finding bugs in this engine: "coherency is completely ignored
 * by the LLM which should be defacto rule 1. Like is this shit logically coherent? No? Fuck I
 * fucked up. It should be able to say 'ignore that last part' … the law or strike or whatever was
 * meant to do that but instead it never fixed the present, just added more guardrails."
 *
 * He is right, and it is the shape of every guard in this file's neighbourhood. EVERY correction in
 * this engine is FEED-FORWARD: last_leak, the maxim quote-back, the figure tic, findRisen, the
 * register gauge. Each one reads committed prose, holds the offending sentence, and argues with the
 * NEXT turn about it. By then the sentence has already become:
 *
 *     prose → scene summary → replayed verbatim in chatlog context
 *           → episodic memory → read back later as a verified fact
 *           → canon, consequences, clocks
 *
 * The error is laundered into truth before the correction arrives, and then the correction is one
 * line arguing against a history that now asserts the opposite. Measured on one save: a dead man
 * walked back in six times WITH a guard already in place, because the guard defended the ledger's
 * location field while the story recorded the resurrection. The DEAD AND GONE block that named him
 * dead was one line against twelve elsewhere in the same prompt showing him alive.
 *
 * So this runs at the only point where the damage is still undone: after the narrator writes and
 * BEFORE anything reads what it wrote.
 *
 * WHAT IT MAY CHECK, AND WHAT IT MAY NOT. Only facts with a yes/no answer the state already holds —
 * a dead person acting, a body doing what that body does not have the parts for, somebody who is
 * not in the room speaking in it. Never register, never pacing, never whether a line is any good.
 * A gate that ventures an opinion will eat somebody's story, and a turn deleted for being
 * unfashionable is far worse than any tic. The taste detectors stay where they are, downstream,
 * feeding forward, which is the right place for taste.
 */
import { bodySeverity, bodyMarks, lostFaculties, FACULTY_LOSS, type Faculty } from "./body";
import { findRisen } from "./exit";
import type { SaveState } from "./types";

export interface Violation { kind: string; line: string; why: string }

/* ── WHAT A BODY CANNOT DO ────────────────────────────────────────────────────────────────────
 *
 * From the save that prompted this: a woman with both arms and both legs removed walks across a
 * hotel lobby with a basket over one arm. The severity fix upstream means the ledger now says
 * plainly what she is; this is the half that checks the sentence against it.
 *
 * Which faculties are actually gone is body.lostFaculties, shared with the card gate in prompts.ts
 * so there is one answer to "can she still do this" and not two that drift. All that lives here is
 * the verb list — what a sentence has to contain before it counts as her doing it.
 *
 * And the verb has to be HERS. "The porter wheels Emily across the lobby toward the lift" was
 * flagged for `lifts?` finding the noun `lift` forty characters downstream, which is the same
 * mistake findRisen already learned: only the verb immediately after the subject counts. */
const V = (body: string) => new RegExp(`^(?:(?:\\w+ly|then|just|still|again|now|already|simply|only|finally)[,\\s]+){0,2}(?:${body})\\b`, "i");

const CANNOT: Record<Faculty, RegExp> = {
  hands: V("reach(?:es|ed)?|grab(?:s|bed)?|hold(?:s)?|held|take(?:s)?|took|carr(?:ies|ied|ying)|lift(?:s|ed)?|point(?:s|ed)?|wave(?:s|d)?|clap(?:s|ped)?|hand(?:s|ed)?|push(?:es|ed)?|pull(?:s|ed)?|wipe(?:s|d)?|fold(?:s|ed)?|clutch(?:es|ed)?|grip(?:s|ped)?|catch(?:es)?|caught|throw(?:s)?|threw|set(?:s)?|put(?:s)?|pour(?:s|ed)?|open(?:s|ed)?|shut(?:s)?|close(?:s|d)?|strike(?:s)?|struck|hit(?:s)?|slap(?:s|ped)?"),
  legs: V("walk(?:s|ed|ing)?|run(?:s|ning)?|ran|stand(?:s|ing)?|stood|step(?:s|ped|ping)?|cross(?:es|ed|ing)?|kneel(?:s|ing)?|knelt|pace(?:s|d)?|climb(?:s|ed)?|rise(?:s|n)?|rose|rising|get(?:s)?\\s+up|got\\s+up|stride(?:s)?|strode|approach(?:es|ed)?|follow(?:s|ed)?|come(?:s)?|came|go(?:es)?|went|leave(?:s)?|left|enter(?:s|ed)?|storm(?:s|ed)?|march(?:es|ed)?|wander(?:s|ed)?|move(?:s|d)?\\s+(?:to|toward|across|away)"),
  sight: V("see(?:s)?|saw|seeing|watch(?:es|ed|ing)?|read(?:s)?|glance(?:s|d)?|stare(?:s|d)?|peer(?:s|ed)?|eye(?:s|d)?|look(?:s|ed)?|study|studies|studied|scan(?:s|ned)?|spot(?:s|ted)?"),
  speech: V("say(?:s)?|said|speak(?:s)?|spoke|whisper(?:s|ed)?|shout(?:s|ed)?|call(?:s|ed)?|answer(?:s|ed)?|repl(?:ies|ied)|mutter(?:s|ed)?|murmur(?:s|ed)?|ask(?:s|ed)?|tell(?:s)?|told"),
  // Not a violation on its own: somebody deaf still turns, still notices, still answers wrong.
  // Nothing in prose reliably distinguishes "heard you" from "saw you say it", so this one stays
  // out of the gate and lives only on the card, where being wrong costs a paragraph of framing.
  hearing: /(?!)/,
};

/** Sentences, keeping punctuation, so a quote can be shown back and a cut can be exact. */
export function sentences(prose: string): string[] {
  return (String(prose ?? "").match(/[^.!?]*[.!?]+["'”’)]*\s*|[^.!?]+$/g) ?? []).filter((s) => s.trim());
}

/**
 * Every hard incoherence in one turn's prose.
 *
 * `presentIds` is who the engine had in the room when the turn was written.
 */
export function checkCoherence(state: SaveState, prose: string, presentIds: readonly string[]): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (v: Violation) => { const k = `${v.kind}|${v.line}`; if (!seen.has(k)) { seen.add(k); out.push(v); } };

  // 1. THE DEAD, ACTING. Already a solved detection — see exit.ts findRisen for why a corpse being
  //    described is fine and only the verb immediately following the name counts.
  const risen = findRisen(state.characters ?? {}, prose);
  if (risen) add({ kind: "dead-acting", line: risen.line, why: `${risen.name} is ${risen.status}` });

  // 2. A BODY DOING WHAT IT HAS NOT GOT THE PARTS FOR.
  const cast = state.characters ?? {};
  const others = Object.values(cast).map((c: any) => String(c?.name ?? "").split(/\s+/)[0]).filter((n) => n.length > 2);
  for (const id of presentIds) {
    const c = cast[id]; const cond = state.condition?.[id];
    if (!c?.name || !cond || bodySeverity(cond) < 3) continue;
    const marks = bodyMarks(cond);
    if (!marks.length) continue;
    const gone = lostFaculties(cond).filter((f) => CANNOT[f].source !== "(?!)");
    if (!gone.length) continue;
    const first = String(c.name).split(/\s+/)[0];
    if (first.length < 3) continue;
    const esc = first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = new RegExp(`\\b${esc}\\b`, "i");
    for (const s of sentences(prose)) {
      if (!named.test(s)) continue;
      // A PRONOUN NEEDS AN UNAMBIGUOUS ROOM. "Emily watches from the chair as he crosses the lobby"
      // has two people in it and only one of them is walking. Where anybody else is named in the
      // same sentence, only her own name may carry the verb.
      const alone = !others.some((n) => n.toLowerCase() !== first.toLowerCase() && new RegExp(`\\b${n}\\b`, "i").test(s));
      // Lookahead, not consumption: "Emily is in the doorway, and then she walks" has two subjects
      // in it and a greedy match would swallow the second inside the first one's tail.
      const subject = new RegExp(alone ? `\\b(?:${esc}|she|he|they)\\b(?=\\s*([^.?!]{0,40}))` : `\\b${esc}\\b(?=\\s*([^.?!]{0,40}))`, "gi");
      let m: RegExpExecArray | null;
      while ((m = subject.exec(s))) {
        // A POSSESSIVE IS NOT A SUBJECT, and for a body it is the difference between a violation and
        // an accurate sentence: "Emily's head turns after you as you rise" is exactly right for a
        // quadriplegic, and the verb belongs to the head. Same rule findRisen needs, for the same
        // reason — the thing after the apostrophe is what is doing it.
        if (/^['\u2019]s\b/.test(m[1])) continue;
        const f = gone.find((g) => CANNOT[g].test(m![1]));
        if (f) {
          add({ kind: "impossible-body", line: s.trim().slice(0, 200),
                why: `${c.name} ${FACULTY_LOSS[f]} — the record reads: ${marks.join(", ").slice(0, 80)}` });
          break;
        }
      }
    }
  }

  /* 3. SOMEBODY NOT IN THE ROOM, TALKING IN IT — TRIED, AND CUT, AND THE REASON IS THE POINT.
   *
   * It was the obvious third check and it does not survive contact. It needs two things this engine
   * cannot give it precisely enough to DELETE somebody's prose over: paragraph attribution, which is
   * a heuristic, and a `present` list that is accurate for the moment the sentence was written.
   * Replayed against three saves it flagged twenty-three turns, and the ones I read were attribution
   * errors — an opening line where a character introduces herself ("Oh! I'm Terri--") credited to a
   * different woman entirely, a lorry driver's question credited to a constable.
   *
   * This file's own header says a gate that ventures an opinion will eat somebody's story, and a
   * check whose evidence is a guess is an opinion however confident it sounds. Two exact checks are
   * worth more than three where one is wrong a third of the time. Somebody speaking from offstage
   * stays with the feed-forward detectors, where being wrong costs a note and not a paragraph. */
  return out;
}

/** What the narrator is told when the turn is sent back. Quotes each offence and names the fact it
 *  contradicts — the same three properties that make last_leak work, minus the delay. */
export function retryNote(vs: readonly Violation[]): string {
  if (!vs.length) return "";
  const rows = vs.slice(0, 4).map((v) => `· "${v.line.trim()}" — ${v.why}.`).join("\n");
  return `\n\nSTOP. WHAT YOU JUST WROTE CONTRADICTS THE RECORD, SO IT HASN'T BEEN KEPT. Write the turn again from the start.\n${rows}\n`
    + `Each of those says something the record says isn't so. Write the same moment with those facts kept: people who are gone stay gone, a body only does what it has the parts for, and nobody speaks who isn't in the room. `
    + `Keep everything else about the turn the same, with the same scene, the same pressure and the same people who are here. Only change what was impossible, and don't have anyone comment on the difference.`;
}

/**
 * The fallback, when a rewrite comes back still wrong: cut the offending sentences.
 *
 * A hole is better than a contradiction, because a hole does not propagate. The sentence that never
 * lands never becomes a summary, a memory, or a line of canon. Kept surgical — the sentence, never
 * the paragraph — and it refuses to run if it would take most of the turn with it, since a turn cut
 * to nothing is its own failure.
 */
export function excise(prose: string, vs: readonly Violation[]): { prose: string; cut: number } {
  if (!vs.length) return { prose, cut: 0 };
  const bad = new Set(vs.map((v) => v.line.trim()));
  let cut = 0;
  const kept = sentences(prose).filter((s) => {
    const t = s.trim();
    const hit = [...bad].some((b) => t === b || t.startsWith(b) || b.startsWith(t.slice(0, 120)));
    if (hit) cut++;
    return !hit;
  });
  const out = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
  if (!out || out.length < String(prose).length * 0.4) return { prose, cut: 0 };
  return { prose: out, cut };
}
