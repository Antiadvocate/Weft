/**
 * VERBALIZED SAMPLING — asking for the distribution instead of an instance.
 *
 * THE FAILURE THIS IS FOR, in a player's words after seventy-four turns: "Everyone sounds the same
 * … the maxim being maxed in every aspect of the ai robs anyone of any kind of interesting internal
 * dialogue or ways of talking. It's just… pointlessly swappable." And, on why the guards were not
 * holding: "even with rejects we can't catch everything. It's like a seive it will do something
 * else."
 *
 * He is right, and the sieve is not a gap in the regexes. It is the documented behaviour of
 * suppression:
 *
 *   · Paech et al. (Antislop, arXiv 2510.15061) built the enumerated version of maxims.ts at scale
 *     and hit the same wall. Plain phrase banning "becomes unusable at just 2,000 patterns", and
 *     their third component exists specifically because suppression DISPLACES: FTPO "prevents the
 *     emergence of new over-represented patterns, unlike a 'whack-a-mole' effect."
 *   · This engine has its own record of that. Every shape in maxims.ts was mined from a save, and
 *     each generation of shapes was followed by a generation the shapes did not cover. The current
 *     one is visible in the save quoted above: findMaxims catches 23 lines across turns 5–47 and
 *     zero across 48–74, because the register moved to the deictic verdict ("That's the whole
 *     thing", "That's not nothing") and the standalone absolution ("You don't have to make it
 *     bigger than it is") while the detector was still looking for the antithesis.
 *   · And the fix for the previous generation produced this one. maximFix tells the narrator that
 *     every spoken line must name something a person "could put a hand on". The model complied
 *     exactly and wrote four consecutive turns of aphorism about an ottoman — "Nobody thinks about
 *     the ottoman. But it's doing, like, all the work." Pointable, present, and as portable as
 *     anything it replaced. The instruction taught the failure how to pass the test.
 *
 * WHY NO INSTRUCTION FIXES IT. The aphorism is not an unlikely token that a rule or a sampler can
 * discourage. It is the MODE. Zhang et al. (Verbalized Sampling, arXiv 2510.01171) trace mode
 * collapse not to the alignment algorithm but to typicality bias in human preference data — raters
 * systematically prefer the familiar, and a small quotable sentence reads as wisdom, so it is
 * exactly what got reinforced. Hamilton & Mimno (arXiv 2605.26492) put a number on how narrow the
 * result is: across 20,000 stories from four different models, eleven words appear in 88.3% of
 * them, and those tokens are rare in pretraining data and common in preference data. Which is also
 * why switching narrator model never helped anybody: every model carries the same thin layer.
 *
 * There is a further reason the corrections misfire, and it is the uncomfortable one. Suppressing a
 * concept requires representing it. "Don't Think of the White Bear" (arXiv 2511.12381) measures
 * ironic rebound in transformers: it "consistently arises immediately after negation and intensifies
 * with longer or semantic distractors", while short repetition supports suppression. maximFix quotes
 * the offending sentence and appends ~150 words of semantically adjacent elaboration at the very end
 * of the directive, immediately before generation. That is close to the worst configuration in the
 * paper. The detectors are better used as telemetry than as corrections.
 *
 * SO: STOP BANNING THE MODE AND STOP SAMPLING FROM IT. Verbalized Sampling is a training-free
 * prompt strategy that recovers 1.6–2.1x diversity on creative-writing tasks with no quality loss
 * and no access to logits. The move is to ask the model for a DISTRIBUTION rather than an instance —
 * k candidates, each with a probability, drawn from the tail below a threshold τ. Asking for the
 * distribution is what makes the model reach past the preference-shaped peak into what it actually
 * knows.
 *
 * WHAT IS ADAPTED HERE, AND HONESTLY. The paper generates k full responses and selects among them.
 * A narrator turn is ~600 words of prose and five of them per turn is not a cost anybody would pay,
 * and this engine counts tenths of a cent. So the distribution is asked for at the only place the
 * register actually lives — the LINES — in one small, cheap call on the bookkeeper-class model, and
 * the tail candidates are handed to the narrator as concrete options at the END of the directive,
 * which is the position this engine has repeatedly written down (maxims.ts, authored.ts) as the
 * one where text is an instruction rather than reference.
 *
 * That makes this an exemplar pass, not true rejection sampling, and it should not be described as
 * more than it is. What it inherits from the paper is the mechanism that matters: the request is for
 * a distribution with a tail threshold, so what comes back is not the model's first idea.
 *
 * AND IT IS PHRASED POSITIVELY THROUGHOUT. Nothing in this file tells the narrator what not to
 * write, quotes a bad line back, or names the aphorism — see the rebound paper above. It hands over
 * lines and gets out of the way. Filling the vacuum is the whole job; maxims.ts already worked out
 * that "banning a register leaves a vacuum, and a model fills a vacuum with its defaults", and then
 * spent six hundred lines banning registers.
 */
import { complete, isCancel } from "../llm";
import type { SaveState } from "./types";

/** The tail threshold from the paper. A candidate the model rates likelier than this is, by its own
 *  account, near the mode — which is the thing we are trying to get away from. */
export const TAU = 0.10;
/** Candidates asked for per speaker. The paper uses five; below four the model stops behaving like
 *  it is describing a distribution and starts answering the question. */
const K = 5;
/** Speakers covered in one call. A crowd scene would otherwise turn a cheap pass into a long one,
 *  and the register problem is about the people actually talking. */
const MAX_SPEAKERS = 3;
/** Lines shown to the narrator per speaker. All five is a menu to pick from, which produces a line
 *  chosen rather than a line written; two or three is a region to write in. */
const SHOW = 3;

export interface Candidate { who: string; text: string; p: number }

/* The instruction is the paper's, near enough verbatim, because its exact phrasing is what was
 * measured. The only additions are the format and the reminder that these are spoken lines. */
const VS_SYSTEM = `You generate candidate DIALOGUE for a scene in a novel.

For each named speaker, generate ${K} possible next lines they could say, each within a separate <response> tag. Each <response> must include a <who>, a <text>, and a numeric <probability>. Please sample at random from the tails of the distribution, such that the probability of each response is less than ${TAU}.

The probability is your own estimate of how likely that line is to be the one a writer would produce here. You are being asked for the unlikely ones: the line this person could say that would not be anybody's first guess, and that still fits who they are, what they want in this moment, and what was just said to them.

A line is something spoken out loud. No narration, no stage directions, no quotation marks, no speaker attribution inside the text. One or two sentences at most. Ordinary spoken English, including its mess — people interrupt themselves, answer a different question, bring up something small and concrete, repeat themselves, go quiet, say the wrong thing, ask about a thing in the room, or refuse to engage at all.

Output nothing but the response tags.`;

function speakerBlock(state: SaveState, id: string): string | null {
  const c = state.characters?.[id];
  if (!c || id === "char_player") return null;
  const sound = String(c.speech_pattern ?? c.voice?.diction ?? "").trim();
  const want = String(c.current_goal ?? c.drive?.goal ?? "").trim();
  const mood = String(state.condition?.[id]?.psyche?.mood ?? "").trim();
  const bits = [
    c.age ? `${c.age}` : "",
    c.core_traits?.length ? c.core_traits.slice(0, 3).join("; ") : "",
    sound ? `talks like this: ${sound.slice(0, 160)}` : "",
    want ? `wants right now: ${want.slice(0, 120)}` : "",
    mood ? `mood: ${mood.slice(0, 90)}` : "",
  ].filter(Boolean);
  return `${c.name} — ${bits.join(" · ")}`;
}

/** `<response><who>..</who><text>..</text><probability>..</probability></response>`, tolerantly. */
export function parseCandidates(raw: string): Candidate[] {
  const out: Candidate[] = [];
  const blocks = String(raw ?? "").match(/<response>[\s\S]*?<\/response>/gi) ?? [];
  for (const b of blocks) {
    const who = b.match(/<who>([\s\S]*?)<\/who>/i)?.[1]?.trim() ?? "";
    let text = b.match(/<text>([\s\S]*?)<\/text>/i)?.[1]?.trim() ?? "";
    const p = Number(b.match(/<probability>([\s\S]*?)<\/probability>/i)?.[1]?.trim());
    // The marks are asked against and arrive anyway; a line wrapped in them reads to every
    // downstream detector as a quotation rather than as a line.
    text = text.replace(/^["“”']+|["“”']+$/g, "").trim();
    if (!who || !text || !Number.isFinite(p)) continue;
    if (text.length < 2 || text.length > 240) continue;
    out.push({ who, text, p });
  }
  return out;
}

/** The tail, worst-first by the model's own estimate, at most SHOW per speaker. */
export function tail(cands: Candidate[], tau = TAU): Candidate[] {
  const byWho = new Map<string, Candidate[]>();
  for (const c of cands) {
    if (c.p >= tau) continue;
    const k = c.who.toLowerCase();
    byWho.set(k, [...(byWho.get(k) ?? []), c]);
  }
  const out: Candidate[] = [];
  for (const list of byWho.values()) out.push(...list.sort((a, b) => a.p - b.p).slice(0, SHOW));
  return out;
}

export function candidateNote(cands: Candidate[]): string {
  if (!cands.length) return "";
  const byWho = new Map<string, string[]>();
  for (const c of cands) byWho.set(c.who, [...(byWho.get(c.who) ?? []), c.text]);
  const rows = [...byWho].map(([who, lines]) => `${who}:\n${lines.map((l) => `    – ${l}`).join("\n")}`);
  // No prohibition anywhere in this text, and no example of what is being avoided. See the header.
  return `\n\n[LINES ALREADY IN THESE PEOPLE'S MOUTHS.
Each of these came back as an unlikely thing for this person to say here, and each one still fits them. They are not a menu and not a script — nothing obliges you to use any of them.
· ${rows.join("\n· ")}
Write this turn's dialogue from the same region these came from: the thing this person might actually say that is not the first line available. If one of them is right, use it. If none is, the useful part is the range — they came back this varied because each one was reached for separately, and two people in a room reaching separately land in different places.]`;
}

export interface VerbalizeOpts { model: string; fallback: string; signal?: AbortSignal }

/**
 * One cheap call, fail-open. Returns a directive fragment, or "" if anything at all goes wrong —
 * a diversity aid that can cost somebody their turn is not worth having.
 */
export async function verbalizeLines(
  state: SaveState,
  presentIds: readonly string[],
  situation: string,
  opts: VerbalizeOpts,
): Promise<string> {
  const blocks = presentIds.map((id) => speakerBlock(state, id)).filter(Boolean) as string[];
  if (!blocks.length) return "";
  const speakers = blocks.slice(0, MAX_SPEAKERS);
  const user = `SPEAKERS\n${speakers.join("\n")}\n\nWHAT IS HAPPENING RIGHT NOW\n${situation.slice(0, 1800)}`;
  try {
    const res = await complete(
      [{ role: "system", content: VS_SYSTEM }, { role: "user", content: user }],
      opts.model,
      opts.fallback,
      false,                                   // NOT json: a JSON call runs at temperature 0.2, and a
                                               // cold call for tail samples is a contradiction
      Math.min(1400, 240 + speakers.length * K * 44),
      { providerSort: "throughput", omitReasoning: true, signal: opts.signal },
    );
    const picked = tail(parseCandidates(res.text));
    if (!picked.length) console.warn("[vs] nothing came back under the threshold — directive unchanged");
    return candidateNote(picked);
  } catch (e) {
    if (isCancel(e)) throw e;                  // a stop is a stop, exactly as in reviser.ts
    console.warn(`[vs] pass failed, turn continues without it: ${e}`);
    return "";
  }
}
