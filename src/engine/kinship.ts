/**
 * KINSHIP — who is related to whom, and the one-line mic drop that invents it.
 *
 * THE FAILURE. Turn 39 of the Seattle save. The player had spent three turns furious that his wife
 * vanished for a night and a day without a word. Mara arrives on the porch and delivers this:
 *
 *     "Emily called me at seven this morning from her sister's couch. She was there all night
 *      because her sister's kid was sick, and she was too tired to drive back, and her phone died
 *      in the car. She told me she'd texted you but it didn't go through. She showed me the text.
 *      The one that says 'staying at Priya's tonight, home by ten.' Priya. Her sister."
 *
 * It is a beautifully built speech and every load-bearing fact in it is invented. Emily's own card
 * reads "the only child of a nurse and a high school teacher" — she has no sister. Priya's card
 * reads "a yoga instructor and the owner of a small studio in Columbia City ... the daughter of
 * Indian immigrants who run a grocery store in the Central District", and her recorded roles are
 * `["neighbor", "friend"]`. Priya is not Emily's sister, has different parents, met her a year ago,
 * and is marked `departed`. There was no sick kid, no dead phone, no undelivered text.
 *
 * The narrator's law already forbids exactly this, at length and by name: "DO NOT invent backstory,
 * phone calls, deaths, or history to fill an emotional space and then treat your own invention as
 * fact next turn ... A character speaking about them says only what the record already holds; where
 * the record is silent, the speaker does not know, has not heard, or says so plainly." A rule that
 * good and that specific, ignored, is a rule that needs a detector behind it.
 *
 * AND IT DOES NOT STOP AT THE PAGE, WHICH IS WHY THIS ONE MATTERS MORE THAN A BAD LINE. The
 * bookkeeper reads the prose and files it. That turn's scene summary — the record of what happened,
 * replayed into every following turn — now reads "Emily had spent the night at her sister Priya's
 * because the kid was sick and her phone died". A queued intent has Emily whispering "I was at my
 * sister's" on a turn that has not been played yet. One invented sister, three places in the state,
 * compounding.
 *
 * WHY DIALOGUE. Every other guard in this engine reads narration. The reviser is explicitly barred
 * from touching a sentence with a quotation mark in it, which is the right trade for prose tics and
 * leaves the mouth of every character in the story as an unpoliced channel for asserting anything
 * at all. The most devastating line a scene can produce is a fact nobody can check, and a model
 * reaching for a devastating line reaches for family, because family is the thing that would settle
 * an argument if it were true.
 *
 * WHAT THIS CHECKS. Only kinship, and only where the record actually contradicts it — an invention
 * the record is merely silent about is a different (and much softer) problem, and flagging it would
 * fire on every legitimate new person a story introduces.
 */
import type { Identity, SaveState } from "./types";
import { pronounsOf } from "./anatomy";

/** Relations the record can hold and the prose can assert. Partners are included because they are
 *  exactly the kind of thing an edge already records, so a contradiction there is checkable too. */
const KIN = "(?:sister|sisters|brother|brothers|sibling|siblings|mother|mom|father|dad|parents?|son|sons|daughter|daughters|aunt|uncle|niece|nephew|cousin|grandmother|grandfather|grandma|grandpa|stepsister|stepbrother|half[- ]sister|half[- ]brother|wife|husband|spouse)";

/** Sibling terms specifically — the only-child check turns on these alone. */
const SIBLING = /^(?:sister|sisters|brother|brothers|sibling|siblings|stepsister|stepbrother|half[- ]sister|half[- ]brother)$/i;

/** A record that says outright this person has no siblings. Deliberately narrow: an inference from
 *  silence ("their background never mentions a brother") is not evidence of absence, and treating it
 *  as evidence would flag every ordinary family a story invents for somebody. Only a stated one. */
const ONLY_CHILD = /\b(?:an?\s+)?only child\b|\bno (?:siblings|brothers or sisters|brothers|sisters)\b/i;

/** Roles that count as kin when they appear on a recorded edge. */
const KIN_ROLE = new RegExp(`\\b${KIN}\\b`, "i");

export interface KinBreach {
  /** The person the prose gave a relative to. */
  owner: string;
  /** The relation asserted. */
  relation: string;
  /** Who it was asserted to be, when the prose named a cast member. */
  other?: string;
  /** Why the record says otherwise. */
  because: string;
  sentence: string;
}

/** Every cast first name, lowercased, for attribution. */
function castFirsts(state: SaveState): { first: string; id: string }[] {
  return Object.entries(state.characters ?? {})
    .map(([id, c]) => ({ first: ((c?.name ?? "").split(/\s+/)[0] ?? "").toLowerCase(), id }))
    .filter((x) => x.first.length >= 3);
}

/** Their own record, as the engine holds it. Not life_history — that is written from the narrator's
 *  prose, so a turn that invented a sister would become the evidence that she exists. */
function ownRecord(c: Identity | undefined): string {
  return [c?.background, ...(c?.core_traits ?? []), ...(c?.values ?? [])].filter(Boolean).join(" ");
}

/** Does the ledger record these two as kin, in either direction? */
function recordedKin(state: SaveState, a: string, b: string): boolean {
  for (const e of state.world?.edges ?? []) {
    const pair = (e.from === a && e.to === b) || (e.from === b && e.to === a);
    if (!pair) continue;
    if ((e.roles ?? []).some((r) => KIN_ROLE.test(String(r)))) return true;
  }
  return false;
}

/**
 * Kinship the prose asserts that the record contradicts.
 *
 * Attribution is positional, the same way anatomy.ts does it and for the same reason: a sentence is
 * full of other people's relatives. The claimant of "her sister" is the nearest cast name before it.
 */
export function findKinBreach(state: SaveState, prose: string): KinBreach | null {
  const cast = castFirsts(state);
  if (!cast.length) return null;
  const owned = new RegExp(`\\b([a-z]+)'s\\s+${KIN}\\b|\\b(?:her|his|their|xer)\\s+(${KIN})\\b`, "gi");

  for (const sentence of String(prose ?? "").split(/(?<=[.!?])\s+|\n+/)) {
    for (const m of sentence.matchAll(owned)) {
      const at = m.index ?? 0;
      // Who the relative belongs to: a possessive name in the match, else the nearest cast name
      // before it in this sentence.
      let ownerFirst = (m[1] ?? "").toLowerCase();
      if (!ownerFirst || !cast.some((c) => c.first === ownerFirst)) {
        const before = sentence.slice(0, at).toLowerCase();
        let bestAt = -1; ownerFirst = "";
        for (const c of cast) {
          for (const hit of before.matchAll(new RegExp(`\\b${c.first}('s)?\\b`, "g"))) {
            if (hit.index !== undefined && hit.index > bestAt) { bestAt = hit.index; ownerFirst = c.first; }
          }
        }
      }
      const owner = cast.find((c) => c.first === ownerFirst);
      if (!owner) continue;                       // nobody on the cast claims this relative
      const ownerChar = state.characters[owner.id];
      const relation = (m[2] ?? m[0].split(/\s+/).pop() ?? "").replace(/[^a-z- ]/gi, "").trim();
      if (!relation) continue;

      // (1) THE RECORD SAYS THEY HAVE NO SIBLINGS.
      if (SIBLING.test(relation) && ONLY_CHILD.test(ownRecord(ownerChar))) {
        return {
          owner: ownerChar?.name ?? owner.first, relation,
          because: `${ownerChar?.name ?? owner.first}'s own record says ${pronounsOf(ownerChar?.pronouns).subj} has no siblings`,
          sentence: sentence.trim().slice(0, 220),
        };
      }

      // (2) THE RELATIVE IS A CAST MEMBER THE LEDGER RECORDS AS SOMETHING ELSE. Only when the prose
      //     names them beside the relation — "her sister Priya", "Priya, her sister", "Priya. Her
      //     sister." — so an unnamed offstage relative is never flagged.
      // WHICH name is the relative: the one nearest the relation word, and a name sitting directly
      // after it wins outright. "Mara said Emily had been at her sister Priya's place" names three
      // people in one clause, and taking whichever the cast happens to be stored in first made
      // Mara the sister. The relative is Priya, because "Priya" is what follows "sister".
      const end = at + m[0].length;
      const window = { lo: Math.max(0, at - 60), hi: Math.min(sentence.length, end + 60) };
      const near = sentence.slice(window.lo, window.hi).toLowerCase();
      const candidates = cast
        .filter((c) => c.id !== owner.id && c.id !== "char_player" && new RegExp(`\\b${c.first}\\b`).test(near))
        .map((c) => {
          let best = Infinity, after = false;
          for (const hit of near.matchAll(new RegExp(`\\b${c.first}\\b`, "g"))) {
            const abs = window.lo + (hit.index ?? 0);
            const d = abs >= end ? abs - end : at - abs;
            if (d < best) { best = d; after = abs >= end; }
          }
          return { ...c, distance: best, adjacent: after && best <= 15 };
        })
        .sort((x, y) => (Number(y.adjacent) - Number(x.adjacent)) || (x.distance - y.distance));
      for (const other of candidates) {
        if (recordedKin(state, owner.id, other.id)) continue;
        const otherChar = state.characters[other.id];
        const roles = (state.world?.edges ?? [])
          .filter((e) => (e.from === other.id && e.to === owner.id) || (e.from === owner.id && e.to === other.id))
          .flatMap((e) => e.roles ?? []);
        return {
          owner: ownerChar?.name ?? owner.first, relation, other: otherChar?.name ?? other.first,
          because: roles.length
            ? `the ledger records them as ${roles.join(", ")}, not family`
            : `the ledger records no family tie between them`,
          sentence: sentence.trim().slice(0, 220),
        };
      }
    }
  }
  return null;
}

/** The correction, quoting the model back to itself on the following turn — the same mechanism as
 *  echo.ts and anatomy.ts, and for the same reason: it can only be said once it has been written. */
export function kinFix(hit: KinBreach | null | undefined): string {
  if (!hit?.sentence) return "";
  const who = hit.other ? `${hit.other} is not ${hit.owner}'s ${hit.relation}` : `${hit.owner} has no ${hit.relation}`;
  return `\nLAST TURN SOMEBODY INVENTED A FAMILY: "${hit.sentence}…"
${who} — ${hit.because}. That is void. It did not happen, nobody said it, nobody remembers it, and no one refers back to it. Do NOT correct it inside the fiction, do not have anyone walk it back, take it back, or be caught in it, and do not write a scene about the mistake; simply continue from the turn before it, as though the line had never been on the page.
AND THE REASON IT GOT WRITTEN IS THE PART TO WATCH. A relative nobody has met is the most powerful thing a character can produce in an argument, because it explains everything and can never be checked — which is exactly why the record has to hold it first. The people in this story have the families the record gives them and no others. Where the record is silent about somebody's family, every character in this world is silent about it too: they do not know, they have not heard, or they say so plainly. If a scene needs a fact to land, use one that is already true; a line that only works because you invented the fact underneath it is not a strong line, it is a line about nothing.`;
}
