/** WHEN SOMEONE IS TAKEN OUT OF A SCENE RATHER THAN WALKING OUT OF IT.
 *
 *  The departure-evidence guard in turn.ts exists for a good reason: the bookkeeper once moved an
 *  entire speaking cast offscene while the prose had them talking to the player, and the next turn
 *  the narrator faithfully rendered an empty room. So the engine stopped trusting the ledger and
 *  started checking the prose for the departure.
 *
 *  It checked for the WRONG THING. The test was a list of verbs a person uses when they choose to
 *  go — left, leaves, exits, slipped out, headed off. Nobody who is REMOVED is described that way.
 *  From save 19, turn 104, the player wrote:
 *
 *      "Eventually the cops show up and arrest Chloe for harassment as other neighbors call.
 *       Chloe goes to prison for 5 years."
 *
 *  and the narrator delivered it — cuffs over her wrists, her rights read in the front room, a car
 *  door out on the curb. The bookkeeper understood perfectly: it created a Prison, it resolved the
 *  thread ("Chloe was arrested and taken away; the porch light vigil is over"), it gave her a new
 *  want ("survive the five years in prison"). Then it tried to move her, and this guard said:
 *
 *      bookkeeping correction: Chloe stays — the prose never showed them leave
 *
 *  Seven turns later she walked back in through the front door, because as far as the world model
 *  was concerned she had never left the living room. At turn 111 the player physically threw her
 *  out and threw the deadbolt — "walking her backward through the open door", "she stumbled out
 *  onto the porch", "The door slammed. The deadbolt turned." — and the guard fired twice more and
 *  pinned her back inside the locked house. Five firings across three turns, every one of them
 *  wrong, holding a state where a woman is serving a five-year sentence and standing in the room.
 *
 *  So the question this file answers is not "did they leave" but "is there any honest reason to
 *  believe they are still in the room". Four kinds of evidence say no:
 *
 *    1. they left           — the original list, widened
 *    2. they were removed   — force, custody, a body going out through a door
 *    3. the player did it   — an unquoted act of the player's own is law; their SPEECH is not,
 *                             because a narrator is allowed to have someone refuse an order
 *    4. the destination is named in the turn's own text
 *
 *  And one kind of evidence says yes, overriding the weaker two: the prose saying, in so many
 *  words, that they did not move. Turn 113 is exactly that — the player says "please fuck off",
 *  the bookkeeper moves Amber out, and the prose reads "Amber didn't move... I'm not going
 *  anywhere." That correction was RIGHT, and it still fires.
 *
 *  Everything here reads narration only. Quoted speech is masked out first, or Amber recalling
 *  "you got arrested, you sat in a cell" would be enough to move somebody out of a room.
 */

/** How far from a name a signal still counts as being about that name. */
const WINDOW = 160;

const HONORIFICS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "doctor", "captain", "lt", "lieutenant", "commander", "sir",
  "madam", "professor", "officer", "ensign", "sergeant", "major", "colonel", "general", "lord",
  "lady", "father", "sister", "brother", "elder", "master",
]);

/**
 * `LEFT` IS TWO VERBS, AND ONE OF THEM ERASED A CHARACTER FROM A STORY.
 *
 * Turn 20 of a real save. The player types "I walk to my room lie in bed and read a book." The
 * prose follows him down the hall, and four paragraphs in, describing the apartment he has left
 * behind:
 *
 *     Out in the living room the television keeps playing to nobody in particular, volume
 *     unchanged from where Abigail left it. A floorboard somewhere near the couch takes weight,
 *     then settles again.
 *
 * That sentence says she is still there. It is about her television and her floorboard. The guard
 * read "Abigail left" — her name inside the matched span, which `owns` treats as settling the
 * question outright — and moved her out of the story. She went to `elsewhere`, and the arrival
 * gate then quoted her eighteen hours of travel back from a place that does not exist, so she was
 * gone for the rest of the session. The player's report: "Abigail vanished for no reason. Into the
 * abyss."
 *
 * `left` transitive means placed, abandoned, put down. "Left it", "left them on the counter",
 * "left behind" — an object being where somebody put it, which is the opposite of evidence that
 * anybody went anywhere. The rule is exactly as narrow as the failure: the next word decides.
 * "Abigail left." and "left the apartment" are untouched.
 */
const PLACED = String.raw`(?!\s+(?:it|them|that|this|these|those|one|behind)\b)`;

/** THEY WALKED OUT. The original list, plus the ways people actually end a visit — by car, by
 *  turning around, by being seen to the door. */
const LEAVES = new RegExp(String.raw`\b((?:left|leaves|leaving)${PLACED}|exits?|exiting|departs?|departing|walks? out|walking out|walked out|strode out|hurried off|heads? off|headed off|dismissed|called away|slipped out|steps? out|stepped out|stepping out|took the lift|made (his|her|xer|their) way out|was summoned|retreated|withdrew|withdrawn|drove off|drove away|drives off|pulled away|walked away|walks away|turned and went|ran off|fled|saw (him|her|them) out|let (him|her|them)self out|walked to (his|her|their) car|got into (the|his|her|their) car)\b`, "i");

/** THEY WERE PUT OUT. A verb of force with somewhere to go — the particle is what keeps "the dish
 *  stayed where she'd pushed it" from reading as an eviction. */
const EJECTED = /\b(?:push(?:ed|es|ing)?|shov(?:e|ed|es|ing)|haul(?:ed|s|ing)?|drag(?:ged|s|ging)?|thr(?:ew|own|ows)|toss(?:ed|es|ing)?|march(?:ed|es|ing)?|escort(?:ed|s|ing)?|forc(?:ed|es|ing)|bundl(?:ed|es|ing)|steer(?:ed|s|ing)?|frog-?march(?:ed|es|ing)?|walk(?:ed|s|ing)?)\b[^.!?]{0,44}?\b(?:out(?:side)?|off the (?:porch|premises|property|steps|stoop)|into the (?:street|hall|hallway|corridor|night|rain|cold)|onto the (?:porch|street|sidewalk|pavement|landing|curb|kerb|lawn|steps|walk|stoop)|through the (?:open |front |back |glass )?door(?:way)?|out the (?:front |back |side )?door|to the (?:door|kerb|curb|cruiser|van))\b/i;

/** THEIR OWN BODY, GOING OUT. What being shoved looks like from the person being shoved. */
const CARRIED_OUT = /\bcarr(?:ied|ies|ying) (?:him|her|them|\w+) ?\w* ?\b(?:out|outside|into the|onto the|through the)\b/i;

/** THEIR OWN BODY, GOING OUT (cont.) */
const SPILLED = /\b(?:stumbl(?:ed|es|ing)|stagger(?:ed|s|ing)?|tumbl(?:ed|es|ing)|sprawl(?:ed|s|ing)|spill(?:ed|s|ing)|caught (?:his|her|their) heel)\b[^.!?]{0,30}?\b(?:out(?:side)?|onto the|into the|through the|off the|down the (?:steps|stairs|walk))\b/i;

/** SOMEBODY ELSE HAS THEM NOW. Custody, commitment, a hospital, a deportation — every way a story
 *  takes a person off the board without their consent and without them leaving. */
const CUSTODY = /\b(?:arrest(?:ed|s|ing)?|under arrest|taken into custody|into custody|handcuff(?:ed|s|ing)?|cuffed|in cuffs|booked (?:him|her|them|into|in at)|detained|remanded|sentenced|convicted|jailed|imprisoned|locked (?:him|her|them) up|taken away|led (?:him|her|them|\w+) away|hauled (?:him|her|them)? ?(?:off|away|out)|carted off|committed to|sectioned|deported|loaded (?:\w+ )?into the (?:ambulance|van|cruiser|car)|put (?:him|her|them) in the (?:car|cruiser|van|back)|wheeled (?:him|her|them|\w+) (?:out|off|into)|taken to the (?:hospital|station|precinct)|goes to prison|went to prison|sent (?:him|her|them) (?:down|away)|read (?:him|her|them|\w+) (?:his|her|their) rights)\b/i;

/** The one piece of custody prose that is a noun, not a verb: cuffs going onto wrists. */
const CUFFS = /\bcuffs?\b[^.!?]{0,24}\b(?:wrists?|hands?)\b|\bhands behind (?:his|her|their) back\b/i;

/** THE PROSE SAYS THEY STAYED. Overrides the circumstantial routes below — the narrator refusing
 *  an order is a legitimate answer, and this is the shape it takes on the page. */
const STAYS = /\b(?:did ?n[o']t move|does ?n[o']t move|has ?n[o']t moved|had ?n[o']t moved|stayed (?:put|where|right)|stays put|did ?n[o']t budge|would ?n[o']t (?:leave|go|move)|refus(?:ed|es) to (?:leave|go|move|budge)|not going anywhere|is ?n[o']t going anywhere|stood (?:his|her|their) ground|remained where|stayed exactly where)\b/i;

/** WHAT THE PLAYER DID, NOT WHAT THEY SAID. An unquoted act of eviction is the player's own hand on
 *  the world. "Get the fuck out", shouted, is a line of dialogue that a character is free to ignore. */
const PLAYER_REMOVES = new RegExp(
  [
    EJECTED.source,
    CUSTODY.source,
    SPILLED.source,
    String.raw`\b(?:kick(?:ed)?|throw|threw|chuck(?:ed)?|boot(?:ed)?|put) (?:him|her|them|\w+) out\b`,
    String.raw`\bcall(?:ed|ing)? the (?:cops|police)\b`,
    String.raw`\bhave (?:him|her|them|\w+) (?:arrested|removed|taken away)\b`,
    String.raw`\bsend (?:him|her|them|\w+) (?:away|home|off|to prison|to jail)\b`,
  ].join("|"),
  "i",
);

/** Index-preserving quote mask: quoted characters become spaces, so offsets and windows still line
 *  up with the original text while dialogue stops counting as narration. */
export function maskQuotes(text: string): string {
  const a = String(text ?? "");
  const out = a.split("");
  let open = false;
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (ch === '"' || ch === "“" || ch === "”") {
      out[i] = " ";
      open = ch === "”" ? false : !open;
      continue;
    }
    if (open && ch !== "\n") out[i] = " ";
  }
  return out.join("");
}

/** The strings that stand for a person in prose: their full name and each usable word of it.
 *  Titles and ranks are skipped — prose almost never repeats them ("Hale left", not "Mr. Hale
 *  left"), and a bare rank ("the captain") is too common a noun to be evidence about anyone. */
export function nameProbes(name: string): string[] {
  const low = String(name ?? "").toLowerCase();
  const tokens = low
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter((t) => t.length >= 3 && !HONORIFICS.has(t));
  return [...new Set([low, ...tokens])].filter((s) => s.length >= 3);
}

/** Every position at which a probe occurs, as [start, end) spans. */
function spansOf(text: string, probes: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const probe of probes) {
    let idx = text.indexOf(probe);
    while (idx !== -1) {
      out.push([idx, idx + probe.length]);
      idx = text.indexOf(probe, idx + 1);
    }
  }
  return out;
}

const gap = (a: [number, number], b: [number, number]): number =>
  a[1] <= b[0] ? b[0] - a[1] : b[1] <= a[0] ? a[0] - b[1] : 0;

/**
 * WHOSE SIGNAL IS IT. Proximity alone puts an arrest on whoever happens to be standing nearby —
 * "Chloe was handcuffed on the steps. Amber watched the whole thing from the window" is one woman
 * being taken away and one woman watching, and a bare window reads it as both. So each match is
 * attributed: a name INSIDE the matched span owns it outright ("shoved Kell out" is about Kell even
 * if someone else is doing the shoving), and otherwise the nearest name wins.
 *
 * The player is never among `others`. The player is the hand in most of these sentences, not the
 * person being removed, and counting them would hand every ejection to whoever threw the punch.
 */
function owns(text: string, probes: string[], others: string[], re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const mine = spansOf(text, probes);
  if (!mine.length) return false;
  const theirs = spansOf(text, others);
  let m: RegExpExecArray | null;
  g.lastIndex = 0;
  while ((m = g.exec(text))) {
    const at: [number, number] = [m.index, m.index + m[0].length];
    if (g.lastIndex === m.index) g.lastIndex++;
    const mineGap = Math.min(...mine.map((s) => gap(s, at)));
    if (mineGap > WINDOW) continue;
    // a name inside the span settles it before distance is consulted
    if (mine.some((s) => gap(s, at) === 0)) return true;
    if (theirs.some((s) => gap(s, at) === 0)) continue;
    const theirGap = theirs.length ? Math.min(...theirs.map((s) => gap(s, at))) : Infinity;
    if (mineGap <= theirGap) return true;
  }
  return false;
}

/**
 * THE STRICT LIST. `CUSTODY` above decides whether somebody may leave a room, and can afford to be
 * generous: a wrong yes only means trusting the ledger, which is what the engine did before this
 * guard existed at all. THIS list decides whether the world keeps HOLDING them, and a wrong yes
 * there takes a character out of the story until a release happens to be written. So it contains
 * only phrasings that cannot mean anything else — no "taken away", which is also what happens to
 * plates, and no "hauled off", which is also what happens to furniture.
 */
const HELD = new RegExp([
  /\b(?:arrest(?:ed|s|ing)?|under arrest|taken into custody|into custody|handcuff(?:ed|s|ing)?|cuffed|in cuffs|detained|remanded|sentenced|convicted|jailed|imprisoned|deported|sectioned|committed to|booked (?:him|her|them|into|in at)|locked (?:him|her|them) up|goes to prison|went to prison|taken to the (?:hospital|station|precinct)|loaded (?:\w+ )?into the ambulance|read (?:him|her|them|\w+) (?:his|her|their) rights)\b/i.source,
  CUFFS.source,
].join("|"), "i");
const REMOVED = new RegExp([EJECTED.source, CARRIED_OUT.source, SPILLED.source, CUSTODY.source, CUFFS.source].join("|"), "i");

/** SOMETHING GAVE THEM BACK. The counterpart to CUSTODY: a person the world took is only in the
 *  world's hands until the story says otherwise, and this is what the story says. Deliberately
 *  generous — a release wrongly accepted costs one scene, a release wrongly refused costs the
 *  player a character forever. */
const RELEASED = /\b(?:releas(?:ed|es|ing)|let (?:him|her|them|\w+) go|let out|bailed (?:out|him|her|them)?|out on bail|post(?:ed|s|ing)? bail|walked free|set free|freed|acquitted|charges? (?:were )?dropped|cleared of|escap(?:ed|es|ing)|broke out|broke free|got out|out of (?:prison|jail|custody|the hospital)|discharged|released from|sentence (?:was )?served|time served|paroled|on parole|sprung (?:him|her|them)|bust (?:him|her|them) out)\b/i;

export type ExitEvidence = { ok: boolean; why: string };

/**
 * Is there honest reason to believe this person is no longer in the scene?
 *
 * `said` is the bookkeeper's own quote of the departure — it is checked against the RAW prose,
 * because a quoted line is exactly the thing the mask removes. Everything else reads narration.
 */
export function departureEvidence(opts: {
  prose: string;
  action?: string;
  said?: string;
  name: string;
  /** the OTHER non-player characters in the scene, so a bystander cannot inherit someone else's
   *  arrest. The player is deliberately excluded — see `owns`. */
  others?: string[];
  destination?: string;
}): ExitEvidence {
  const rawLow = String(opts.prose ?? "").toLowerCase().replace(/\s+/g, " ");
  const proseLow = maskQuotes(String(opts.prose ?? "")).toLowerCase().replace(/\s+/g, " ");
  const probes = nameProbes(opts.name);
  const own = new Set(probes);
  const others = (opts.others ?? []).flatMap(nameProbes).filter((p) => !own.has(p));

  // the bookkeeper quoted the departure and the quote is really there
  const saidRaw = String(opts.said ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (saidRaw.length >= 8 && rawLow.includes(saidRaw)) return { ok: true, why: "quoted" };
  if (!probes.length) return { ok: false, why: "" };

  // THE PROSE GETS THE LAST WORD. If it says this person did not move, they did not move — a
  // narrator refusing an order is a legitimate answer, and turn 113 of save 19 is exactly that:
  // "Amber didn't move... I'm not going anywhere." Checked before any evidence for going, because
  // the removal in a line like "he shoved her out onto the porch. Bern didn't move." belongs to
  // somebody the sentence never named.
  const stayed = owns(proseLow, probes, others, STAYS);
  if (stayed) return { ok: false, why: "" };

  if (owns(proseLow, probes, others, LEAVES)) return { ok: true, why: "left" };
  // custody is called out separately: somebody else has them now, and that is a state the world
  // has to keep holding after this turn ends. See `heldEvidence` / `releaseEvidence`.
  if (owns(proseLow, probes, others, HELD)) return { ok: true, why: "custody" };
  if (owns(proseLow, probes, others, REMOVED)) return { ok: true, why: "removed" };

  // THE PLAYER'S OWN HAND. Quoted speech is stripped first: the engine treats dialogue as dialogue
  // everywhere else, and a shouted order is something a character may refuse.
  const deeds = String(opts.action ?? "").replace(/["“][^"”]*["”]/g, " ");
  if (PLAYER_REMOVES.test(deeds)) {
    const deedLow = deeds.toLowerCase();
    // naming them is enough on its own; an unnamed "I push her out" needs the prose to show a
    // removal happening SOMEWHERE, so one eviction can't clear the whole room
    if (probes.some((p) => deedLow.includes(p))) return { ok: true, why: "player's act, named" };
    // ...and the removal in the prose must not visibly belong to somebody else
    if (REMOVED.test(proseLow) && !others.some((o) => owns(proseLow, [o], probes, REMOVED)))
      return { ok: true, why: "player's act" };
  }

  // WHERE THEY WENT IS IN THE TEXT. If the turn itself names the destination, the move is grounded.
  // `elsewhere` never counts — moving the cast to nowhere is the failure this guard was built for.
  const dest = String(opts.destination ?? "").trim().toLowerCase();
  if (dest.length >= 4 && dest !== "elsewhere" && !dest.startsWith("loc_offscene")) {
    if (proseLow.includes(dest) || deeds.toLowerCase().includes(dest)) return { ok: true, why: "destination named" };
  }

  return { ok: false, why: "" };
}


/**
 * DID SOMETHING GIVE THEM BACK. Read on every turn for anyone the world is holding — the release
 * can be narrated while they are offscreen ("word came that Chloe was out by Tuesday"), and it can
 * be the player's own doing ("I post her bail"). Quoted speech is masked as everywhere else, so
 * somebody merely SAYING she got out is not the same as her getting out.
 */
export function releaseEvidence(opts: { prose: string; action?: string; name: string; others?: string[] }): boolean {
  const probes = nameProbes(opts.name);
  if (!probes.length) return false;
  const own = new Set(probes);
  const others = (opts.others ?? []).flatMap(nameProbes).filter((p) => !own.has(p));
  const proseLow = maskQuotes(String(opts.prose ?? "")).toLowerCase().replace(/\s+/g, " ");
  if (owns(proseLow, probes, others, RELEASED)) return true;
  const deeds = String(opts.action ?? "").replace(/["\u201c][^"\u201d]*["\u201d]/g, " ").toLowerCase();
  return RELEASED.test(deeds) && probes.some((p) => deeds.includes(p));
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * THE DEAD WALKING BACK IN, AND THE LEDGER WRITING IT DOWN.
 *
 * A player, after the third time: "Again and again Arthur comes back."
 *
 * The guard in turn.ts already refuses to MOVE a dead character into the scene — "the gone do not
 * walk back in" — and it works: after his death at turn 102 Arthur Penhale never appears in a
 * `present` list again. What it defends is the ledger's location field, and nothing else, so the
 * turn it blocks is a turn whose PROSE has already had him walk through a revolving door. The
 * engine then records that turn faithfully. From the save at turn 132, all of it in the digest the
 * narrator reads:
 *
 *   summary T128  Rabi shot Arthur Penhale dead in the head across the lobby of The Ritz.
 *   summary T131  Rabi sat waiting on the floor by the bar amongst the dead policemen as
 *                 Arthur Penhale walked back through the revolving doors.
 *   RECALLS       I sat on the floor of The Ritz waiting beside the dead constables, and
 *                 Arthur Penhale walked back inside through the revolving doors ALIVE.
 *
 * So one hallucination became canon, and from there the evidence compounds: every later turn is
 * written against a history in which he came back, and he had died twice more by turn 131 — once
 * strangled, once shot — each death generating its own consequence record.
 *
 * A block naming him dead does not survive that. Measured on that save, the DEAD AND GONE block is
 * one line against twelve elsewhere in the same prompt that show him alive and acting. Telling the
 * narrator the truth once, in a document where the story itself says otherwise twelve times, is not
 * a fix. The contradiction has to be refused where it enters.
 *
 * So: catch it in the committed prose, keep it out of the record, and quote it back — the mechanism
 * this engine trusts everywhere else (see last_leak, maxims.ts) and the only one that has reliably
 * stopped a narrator habit.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */

/** Verbs that only a living person performs. A corpse can be described, moved, bled from and
 *  stepped over — "the blood spreading from Arthur Penhale" is correct prose about a dead man and
 *  must not trip this. What a dead man does not do is arrive, speak, or act on his own. */
const LIVING_VERB = /^(?:says?|said|asks?|asked|answers?|answered|answer|replies|replied|reply|speaks?|spoke|speak|calls?|called|call|shouts?|shouted|whispers?|murmurs?|adds?|nods?|shrugs?|smiles?|laughs?|laugh|turns?|turned|turn|looks?|looked|look|walks?|walked|walk|steps?|stepped|step|comes?|came|come|enters?|entered|enter|arrives?|arrived|arrive|stands?|stood|stand|sits?|sat|sit|moves?|moved|move|takes?|took|take|reaches?|reached|reach|holds?|held|hold|puts?|put|lifts?|lift|raises?|raise|pulls?|pull|pushes?|push|opens?|open|closes?|close|crosses?|crossed|cross|drinks?|drank|drink|eats?|ate|eat|watches?|watched|watch|waits?|waited|wait|follows?|followed|follow|leans?|leaned|lean|appears?|appeared|appear|returns?|returned|return)\b/i;

/** Words that may stand between a subject and its verb without changing who the subject is.
 *  "Arthur Penhale does not answer at once." — the verb is his; the auxiliary and the negation are
 *  not another person. */
const BEFORE_VERB = /^(?:\s*(?:does|did|do|is|was|are|were|has|had|have|will|would|can|could|must|not|n't|never|then|still|also|already|just|again|slowly|only|finally|now|simply|almost|nearly|\w+ly)\b)*\s*/i;

/** Titles are not names: splitting "Dr. Eleanor Vance" on whitespace gives "Dr." as the first
 *  token, and a full stop also ends a sentence, so the whole name never survives the split. */
const TITLE = /^(?:dr|mr|mrs|ms|miss|sir|lord|lady|fr|st|prof|capt|sgt|lt|col|gen|rev)\.?$/i;

export interface RisenHit { name: string; status: string; line: string }

/**
 * A character the story has finished, acting in this turn's prose.
 *
 * Sentence by sentence, on the UNMASKED text, because a dead man being given dialogue is the
 * clearest case of all. Only fires when the name is the grammatical subject — the name, then a
 * living verb before any other capitalised name intervenes — so "he too is looking at Arthur" and
 * "the blood spreading from Arthur Penhale" are left alone.
 */
export function findRisen(
  characters: Record<string, { name?: string; status?: string }>,
  prose: string,
): RisenHit | null {
  const gone = Object.values(characters ?? {})
    .filter((c) => c?.name && (c.status === "dead" || c.status === "departed"))
    .map((c) => ({
      name: String(c.name),
      status: String(c.status),
      // every usable token, because a title both hides the given name and breaks the sentence split
      forms: [String(c.name), ...String(c.name).split(/\s+/).filter((w) => w.length >= 3 && !TITLE.test(w))],
    }));
  if (!gone.length) return null;
  for (const raw of String(prose ?? "").split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.trim();
    if (s.length < 12) continue;
    for (const g of gone) {
      for (const form of g.forms) {
        const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const m = new RegExp(`\\b${esc}\\b([^.?!]{0,48})`, "i").exec(s);
        if (!m) continue;
        const tail = m[1];
        // A POSSESSIVE IS NOT A SUBJECT. "Arthur Penhale's name" and "Arthur Penhale's mouth" put a
        // noun in the subject slot; the name is only describing it.
        if (/^['’]s\b/.test(tail)) continue;
        // AND THE VERB HAS TO BE THEIRS. Scanning the next forty characters for any living verb
        // reads "The body on the floor is Arthur Penhale, and the blood has REACHED the pillar" and
        // "Nobody has said Arthur Penhale's name since the police CAME" as the dead man acting — the
        // subject in both is something else that arrived in between. Only the verb that immediately
        // follows the name, past auxiliaries and adverbs, belongs to it.
        if (LIVING_VERB.test(tail.replace(BEFORE_VERB, ""))) return { name: g.name, status: g.status, line: s.slice(0, 200) };
      }
    }
  }
  return null;
}

/** The correction, at the end of the directive where instructions live. */
export function risenFix(hit: RisenHit | null | undefined): string {
  if (!hit) return "";
  return `\nLAST TURN YOU BROUGHT BACK SOMEBODY WHOSE STORY IS OVER. ${hit.name.toUpperCase()} IS ${hit.status.toUpperCase()}, and this sentence has them doing something: "${hit.line}"`
    + `\nThat didn't happen, and it isn't in the record. ${hit.name} doesn't walk in, speak, arrive, turn, look, wait or reach for anything, this turn or any turn after it. `
    + `Where the story has already shown them gone, they stay gone. A body stays a body, and it can be described, stepped around or carried, but that's all it can do now. `
    + `If the scene needs someone, a different person arrives, or nobody does and the scene works around their absence. `
    + `Write this turn as if the sentence above had never been written, and don't have anyone in the scene comment on their return, explain it or wonder about it.`;
}
