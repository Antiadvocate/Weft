/**
 * EXPERTISE — the eighteen-year-old who quoted the National Electrical Code.
 *
 * The player's report: "there was one game where Abigail literally quoted me the NEC."
 *
 * Abigail is eighteen. She dropped out of community college after a term and works four-hour shifts
 * at a tanning salon. Her recorded skills, in full: psychological boundary testing, pedicure and
 * foot grooming, budget management. Her brother Max — sitting across the coffee table — proofreads
 * HVAC instruction manuals for a living, and the apartment's window unit has a dead compressor. So
 * the domain was live in the room, and it came out of the wrong mouth.
 *
 * WHY IT COMES OUT OF THE WRONG MOUTH, and this is the whole design of this file. The cast card
 * sends the narrator this, and only this:
 *
 *     Established skills: Psychological boundary testing, Pedicure and foot grooming, Budget management.
 *
 * A list of what somebody knows. Nothing anywhere says what they do NOT know. This engine has
 * already learned that lesson once and written it down in world_bible.absent: ABSENCE CANNOT BE
 * INFERRED FROM DESCRIPTION — a list of what a world contains is not read as a list of what it
 * lacks, so the missing thing has to be stated outright or it gets invented. Skills had the same
 * hole, in the same shape, and nobody had said so. Faced with a scene that needs a fact about
 * amperage, the narrator has a list that does not forbid her and a domain the scene has made
 * salient, and she is the one whose turn it is to talk.
 *
 * AND THE PLAYER NAMED THE MECHANISM BETTER THAN I WOULD HAVE: "instead of generating messy, highly
 * specific real-world nuance, the statistical distribution naturally clusters around well-worn
 * tropes." That is the same failure as the numbers in saturation.ts, arrived at from the other side.
 * Asked for authority, a model reaches for the most citable object in the domain — a code section, a
 * standard number, a rated figure — because that is what authority looks like in text. It is the
 * cheapest possible way to sound like someone who knows, and it requires knowing nothing. Real
 * expertise in a mouth sounds like grievance and shortcut and the specific thing that went wrong
 * last time, and almost never like a citation.
 *
 * WHAT THIS FILE WILL AND WILL NOT CLAIM. I do not have the save with the NEC line — it is from a
 * game the player no longer has loaded — so there is no specimen to fit a pattern to, and fitting a
 * pattern to a phrasing I have imagined is precisely the mistake pressure.ts's power-tier regex made
 * and this codebase records. So the table below is built from the one thing that is safe to assert
 * without a specimen: A CITATION IS NOT CASUAL SPEECH. Nobody produces "NEC 210.52" or "ANSI Z87.1"
 * or "per CFR part 1910" in conversation without the training that put it there. Everything else in
 * the table is a short list of registers that carry the same property, and every single hit is then
 * gated against the speaker's OWN record — the way anatomy.ts and kinship.ts work, and for the same
 * reason: the record decides, never the category, never my sense of who ought to know what.
 *
 * SO THE FALSE-POSITIVE STORY IS THE RECORD, NOT THE REGEX. Measured over 606 turns of fourteen
 * saves, the terms below appear in dialogue six times and FIVE of them are correct — Kristi
 * Bergstrom saying "I'm on the load calc … a six-hundred-kVA load on a four-fifty bank" is a woman
 * whose card reads "Load calculation and transformer sizing: Expert", and the guard must never
 * touch her. Only a term whose domain nobody has given this speaker is a fault.
 */
import type { SaveState, Identity } from "./types";
import { bySpeaker } from "./saturation";

/**
 * The domains, each one a pair: what a practitioner says, and what the record has to show for the
 * speaker to be allowed to say it.
 *
 * `owns` is matched against the speaker's skill keys, their skill descriptions and their background
 * — everything the record actually holds about what they have done with their life. Deliberately
 * loose, because a miss here means scolding somebody who really is a nurse.
 */
interface Domain {
  name: string;
  /** Terms only a practitioner produces. */
  says: RegExp;
  /** Anything in the record that grants the domain. */
  owns: RegExp;
}

const DOMAINS: Domain[] = [
  // A CODE CITATION IS THE CLEAREST CASE IN THE FILE and is its own domain, because the tell is the
  // ACT of citing rather than the subject: a section number attached to a standards body is a thing
  // a person says because a job made them say it for years.
  {
    name: "codes and standards",
    // The whole citation, not its first digit — the correction quotes this term back, and "NEC 2"
    // is not a thing anybody said.
    says: /\b(?:NEC|NFPA|OSHA|ANSI|ASTM|IEEE|ASHRAE|IBC|IRC|UL)\s?\d+(?:\.\d+)*[A-Z]?\b|\b(?:NEC|NFPA|OSHA|ANSI|ASTM|ASHRAE)\b|\b(?:article|section|part|title)\s+\d{2,4}(?:\.\d+)*\b|\b\d+\s?CFR\b|\bper\s+code\b|\bcode\s+(?:section|requires|says|violation)\b/i,
    owns: /\b(?:engineer|engineering|electric|electrical|electrician|inspector|inspection|code|contractor|construction|build|builder|architect|plumb|HVAC|permit|safety|compliance|lawyer|attorney|law|regulat|surveyor|foreman|trades?)\b/i,
  },
  {
    name: "electrical work",
    says: /\b(?:ampacity|amperage|AWG|romex|conduit|load calc\w*|voltage drop|ground fault|GFCI|AFCI|three-phase|neutral bus|busbar|kVA|transformer sizing|service panel|breaker panel|derat\w+)\b/i,
    owns: /\b(?:electric|electrical|electrician|engineer|engineering|grid|substation|lineman|utility|power compan|city light|wiring|HVAC|mechanical|maintenance|facilit\w+|trades?)\b/i,
  },
  {
    name: "medicine",
    says: /\b(?:contraindicat\w+|milligrams? per|mg\/kg|intubat\w+|tachycard\w+|bradycard\w+|sats?\s+(?:are|dropp)|IV push|bolus|differential diagnosis|presenting with|stat dose)\b/i,
    owns: /\b(?:nurse|nursing|doctor|physician|medic|paramedic|EMT|surgeon|hospital|clinic|pharmac|midwif|veterinar|medical)\b/i,
  },
  {
    name: "law",
    says: /\b(?:tortious|statute of limitations|prima facie|habeas|discovery motion|deposition|voir dire|fiduciary duty|constructive eviction|quiet enjoyment|implied warranty of habitability)\b/i,
    owns: /\b(?:lawyer|attorney|paralegal|law|legal|court|judge|clerk|tenant.?s? union|advoca|landlord|property manage)\b/i,
  },
];

export interface ExpertiseHit {
  who: string;
  domain: string;
  /** The exact term, quoted back. */
  term: string;
  /** The line it was in. */
  line: string;
  /** Somebody present whose record DOES cover it, when there is one — the line belonged to them. */
  instead?: string;
}

/** Sentences of a background that are about WORK. The rest of a background is a life, and a life
 *  contains anecdotes: Abigail's says she "calmly dismantled their father's electric clippers with a
 *  butter knife" as a child, and reading the whole background as credentials let that one clause
 *  grant her the entire electrical domain — so the NEC line this file was written for went
 *  undetected on the first run. A childhood story is not a trade. Only a clause that says somebody
 *  DID THIS FOR A LIVING counts. */
const OCCUPATION = /\b(?:works? as|worked as|working as|employed|apprentic\w+|trained as|studies|studied|certification|licensed|her job|his job|their job|career|\d+ years (?:with|at|as|of)|dropped out of the \w+ (?:program|course))\b/i;

/** What the record holds about what this person can actually DO.
 *
 *  Skills first and always: the forge's schema calls that field "the competence", 3-5 entries, and
 *  it is the only place in a character record whose purpose is to say what somebody is able to do.
 *  Background contributes only its working sentences. */
function credentials(c: Identity | undefined): string {
  if (!c) return "";
  const sk = c.skills && typeof c.skills === "object"
    ? Object.entries(c.skills).map(([k, v]) => `${k} ${v ?? ""}`).join(" ")
    : "";
  const work = String(c.background ?? "").split(/(?<=[.!?])\s+/).filter((x) => OCCUPATION.test(x)).join(" ");
  return [sk, work].join(" ");
}

/**
 * A speaker using knowledge their own record does not give them.
 *
 * The player is never checked: they may know anything, it is their character, and a note telling the
 * narrator the player was too knowledgeable is unactionable.
 */
export function findExpertise(state: SaveState, prose: string, playerName = ""): ExpertiseHit | null {
  const chars = Object.values(state.characters ?? {}) as Identity[];
  const names = chars.map((c) => c?.name ?? "").filter(Boolean);
  const cred = new Map<string, string>();
  for (const c of chars) if (c?.name) cred.set(c.name, credentials(c));

  for (const [who, lines] of bySpeaker(prose, names.filter((n) => n !== playerName.trim()))) {
    const mine = cred.get(who) ?? "";
    for (const line of lines) {
      for (const d of DOMAINS) {
        const m = line.match(d.says);
        if (!m) continue;
        // THE RECORD NAMING THE TERM IS THE STRONGEST POSSIBLE GRANT, and it has to be checked
        // separately from `owns`. A woman whose skill key is literally "Load calculation and
        // transformer sizing" owns load calculation whether or not her description also contains the
        // word "electrical"; a man who dropped out of an HVAC certification programme owns HVAC. An
        // `owns` list is a guess at how a competence gets described, and the record often describes
        // it in the domain's own words instead.
        if (d.owns.test(mine) || d.says.test(mine)) continue;   // the record grants it — correct writing
        // Whose line was it? Naming the person who should have said it turns the correction from a
        // prohibition into a redirection, which is the only form of it that produces a better scene.
        const instead = names.find((n) => n !== who && d.owns.test(cred.get(n) ?? ""));
        return { who, domain: d.name, term: m[0].trim(), line: line.slice(0, 180), instead };
      }
    }
  }
  return null;
}

/**
 * THE CARD'S MISSING HALF.
 *
 * `charCard` sends "Established skills: a, b, c." and stops, which states what somebody knows and
 * leaves what they do not know to be inferred from a list — the exact move world_bible.absent
 * exists to forbid. This is the sentence that was missing. It costs about fifteen tokens and it is
 * the only thing on the card that can refuse a line.
 */
export function unskilledNote(ident: Identity): string {
  const keys = ident.skills && typeof ident.skills === "object" ? Object.keys(ident.skills) : [];
  if (!keys.length) {
    return ` No trade or body of specialist knowledge is recorded for ${ident.name ?? "them"}: they speak about every technical subject as somebody who has only ever been a customer of it.`;
  }
  return ` THAT LIST IS EXHAUSTIVE. Outside those, ${ident.name ?? "this person"} has a layman's knowledge and a layman's vocabulary — they can describe what a thing does to them and what it costs them, and they cannot name its parts, cite a rule about it, or say how it works. When this scene needs a fact from a trade that is not on that list, either somebody who has it says it, or nobody does and the fact stays unknown.`;
}

/** The correction, at the end of the directive where instructions live. */
export function expertiseFix(hit: ExpertiseHit | null | undefined): string {
  if (!hit?.who) return "";
  const redirect = hit.instead
    ? `THAT LINE BELONGED TO ${hit.instead.toUpperCase()}, whose record does cover it. If the scene needs the fact, ${hit.instead} says it — and says it the way somebody says a thing they have known for years, which is impatiently and without explaining the parts.`
    : `NOBODY PRESENT HAS THAT KNOWLEDGE, so the fact does not get established this turn. A scene is allowed to contain a question nobody in it can answer; that is more interesting than a wrong person answering it.`;
  return `\n${hit.who.toUpperCase()} USED KNOWLEDGE THEIR RECORD DOES NOT GIVE THEM: "${hit.term}", in the line "${hit.line}". Their card lists what they know and ${hit.domain} is not on it.
${redirect}
AND A CITATION IS THE WRONG SOUND FOR EXPERTISE ANYWAY. Reaching for a code number, a standard, or a rated figure is what authority looks like written down, and it is almost never what it sounds like spoken. Somebody who really does this work talks about it in grievances and shortcuts: what fails first, who they had to argue with about it, the one they saw go wrong, what everybody gets wrong about it, what they stopped bothering to do years ago. Give the expert THAT and give everybody else a layman's words — what it costs, what it sounds like, who they would have to call.`;
}

/** For the ledger. */
export function expertiseNote(hit: ExpertiseHit): string {
  return `${hit.who} spoke ${hit.domain} ("${hit.term}") — not on their record`;
}
