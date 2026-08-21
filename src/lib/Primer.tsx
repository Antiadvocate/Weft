import React from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";

/**
 * THE PRIMER — the whole game in one scroll.
 *
 * The per-screen guides say what a control does while you are looking at it. This says how the
 * thing WORKS: the four channels in the composer, what the world will and will not take from you,
 * and where to reach when a turn goes wrong. It is the README's player-facing half, in the app,
 * because the README is not in the app and nobody reads it first.
 */

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <code style={{
    fontFamily: "var(--font-mono)", fontSize: "0.86em", color: "var(--accent)",
    background: "var(--accent-soft)", borderRadius: 5, padding: "1.5px 5px",
    boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
  }}>{children}</code>
);

function Section({ kicker, title, children }: { kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="font-mono text-[9.5px] uppercase tracking-widest mb-1" style={{ color: "var(--accent)" }}>{kicker}</div>
      <h2 className="font-display text-[19px] mb-2" style={{ color: "var(--text-hi)" }}>{title}</h2>
      <div className="space-y-2.5 text-[13.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{children}</div>
    </section>
  );
}

/** A worked example: what you type, and what the world does with it. */
function Example({ typed, effect }: { typed: React.ReactNode; effect: string }) {
  return (
    <div className="card p-3 my-2.5">
      <div className="text-[12.5px] leading-relaxed" style={{ fontFamily: "var(--font-mono)", color: "var(--text-hi)" }}>
        {typed}
      </div>
      <div className="text-[12px] leading-relaxed mt-2 pt-2" style={{ color: "var(--text-lo)", borderTop: "1px solid var(--line)" }}>
        {effect}
      </div>
    </div>
  );
}

export default function Primer({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 130 }}>
      <motion.div className="drawer-veil" style={{ position: "absolute", inset: 0 }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          background: "var(--ink-0)", maxWidth: 680, margin: "0 auto",
          borderLeft: "1px solid var(--line)", borderRight: "1px solid var(--line)",
        }}>
        <div className="flex items-center justify-between px-5 py-2.5 shrink-0"
          style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--text-lo)" }}>
            how weft works
          </div>
          <button onClick={onClose} aria-label="close"><X size={17} style={{ color: "var(--text-lo)" }} /></button>
        </div>

        <div className="scroll-y flex-1 px-5 py-5">

          <Section kicker="the shape of it" title="A world, not a script">
            <p>
              There are no branches, no written endings and nothing waiting to be found. There is a place,
              a cast of people who each want something, and a set of clocks already running.
            </p>
            <p>
              A turn is two passes. A <strong style={{ color: "var(--text-hi)" }}>narrator</strong> writes what
              happens next, then a <strong style={{ color: "var(--text-hi)" }}>bookkeeper</strong> reads that prose
              and records what actually changed — who moved where, who learned what, who now trusts you less,
              which clock ticked. Everything after that is arithmetic, and free.
            </p>
            <p>
              So the story does not remember you because a model is holding a long chat in its head. It remembers
              you because the change was written down.
            </p>
          </Section>

          <Section kicker="the composer" title="Four channels, one box">
            <p>Everything you type goes in one field, and it is read on four channels. You can mix all four in a single message.</p>

            <Example
              typed={<>"Where were you last night?"</>}
              effect="Double quotes are spoken aloud, in your own voice. Everyone present hears it. The narrator treats it as already said and answers it — it never gets repeated back at you, and it is never put in someone else's mouth."
            />
            <Example
              typed={<>*she's lying and she knows I know*</>}
              effect="Asterisks are a private thought. No character can hear it, intuit it, overhear it, or act on it — not ever, not even a character written as perceptive. It is genuinely sealed."
            />
            <Example
              typed={<>I pour the second cup. (I want her to stay, I'm not going to say so)</>}
              effect="Parentheses are your private inner state: the feeling or motive under the act. It decides how your body does the thing. Others see only the act and read it through their own eyes — which may be wrong, and often is."
            />
            <Example
              typed={<>I take the knife off the table and put it in my coat.</>}
              effect="Anything unmarked is physical action, and it happens exactly as written."
            />

            <p className="pt-1">
              Mixing them is the normal case, and it is where the engine earns its keep:
            </p>
            <Example
              typed={<>I set the cup down and stay standing. "I'm not signing that." (my hands are shaking, don't let her see) *she's bluffing, she has to be*</>}
              effect="The room hears one sentence and sees a man who put down a cup and did not sit. It never learns about the hands or the guess. But the hands are what your body was doing while you said it, and the bookkeeper reads all of it for your mood — not for theirs."
            />
          </Section>

          <Section kicker="the contract" title="What you do is law. What you claim is not">
            <p>
              A declared action <strong style={{ color: "var(--text-hi)" }}>occurs, exactly as declared</strong>, at
              the scale you declared it. The world does not veto you, soften you, or quietly make you fail.
              Consequences follow the act; they never replace it.
            </p>
            <p>
              Assertions are different. Saying a thing is true does not make it true. Ask for the nearest hospital in
              a world that has no such word and people will be baffled, hear the closest thing their own life holds,
              or correct you. That friction is the story working, not a bug — a stranger reasoning from the wrong
              world is drama.
            </p>
            <p>
              Your character has no past beyond what you have said aloud or written on their sheet. Nobody will hand
              you a hometown or an old wound you did not claim.
            </p>
          </Section>

          <Section kicker="talking to the machine" title="Complaints are direction, not story">
            <p>
              If you type <em>"this pacing is dragging"</em> or <em>"stop giving me weather"</em>, that is you talking to the
              software, not your character talking to the world. Weft detects it, does not dramatise it, and turns it into
              standing direction the narrator has to answer.
            </p>
            <p>
              An aside next to a real action loses the aside and keeps the action. Anything you actually want your
              character to do — including something terrible — still happens; say it as the character and it is law.
            </p>
          </Section>

          <Section kicker="the + button" title="Do, Story, web, and tightness">
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Do</strong> is you acting inside the world.{" "}
              <strong style={{ color: "var(--text-hi)" }}>Story</strong> hands you the pen — you narrate what happens next
              and the engine weaves it in, keeping the world's own logic. Use Story to move the camera, cover a
              stretch, or bring something about; use Do for everything else.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>web</strong> runs this one reply through a live web search, so a
              story set in a real place or built on real material gets the actual streets and facts right. You pay for
              search only on the turns you ask for it.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>tight 0–5</strong> is how tight your body is right now against your
              own baseline. Leave it off and the engine reads it from your words. <Kbd>base</Kbd> makes the number a
              standing ceiling — a bad night's sleep the clock cannot see — instead of a one-turn spike.
            </p>
          </Section>

          <Section kicker="steering" title="Telling it what kind of story this is">
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Genre &amp; register</strong> (⋯ menu, or set it at the Forge) is the
              key the whole thing is written in. Set it. Without one, models drift toward the same quiet literary
              character study whatever you seeded.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Narrator direction</strong> is standing orders, and it sits at the very
              top of the prompt — above the world bible, above the cast, above the model's own taste in drama. If you
              say a power or a topic is incidental and not the story, it stays peripheral. The model subverting your
              premise to chase tension is defined as its worst possible failure.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Drive toward an event</strong> makes the story converge: unrelated chaos
              is suppressed, every scene bends toward the throughline, and when the event fires on the clock the story
              shifts into it on its own.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>World tension</strong> (Tuning, 0–10) is the master dial for how much the
              world throws at you. At <strong style={{ color: "var(--text-hi)" }}>0 nothing new is ever introduced</strong> — no
              fresh threats, threads, or faction moves; the world only answers what you do. 5 is the normal rhythm.
            </p>
          </Section>

          <Section kicker="when a turn goes wrong" title="Four different repairs">
            <p>
              They are not the same tool, and reaching for the wrong one costs you the scene:
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Veto</strong> — the narrator invented something you refuse. The turn is
              rolled back past it and the invention is voided permanently. Use this for a fact that must never have
              existed.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Correct the record</strong> — the prose was fine but it ignored a rule of
              your world. Affirms the rule as world law going forward. Nothing is rolled back.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Re-run the bookkeeper</strong> — the prose was right and the record is
              wrong (the wrong person moved, a feeling landed backwards). Keeps every word, rebuilds the state.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Roll back</strong> — return to any earlier turn wholesale. There is an
              undo for the rollback itself, so it is safe to try.
            </p>
            <p>
              Two more live in the ⋯ menu. <strong style={{ color: "var(--text-hi)" }}>Clear the log</strong> stops the narrator
              reading earlier turns without deleting anything — the cure for a story stuck in a loop.{" "}
              <strong style={{ color: "var(--text-hi)" }}>Refresh memory</strong> condenses memory drift and clears runaway threads,
              same moment, same people. And <strong style={{ color: "var(--text-hi)" }}>stop</strong> aborts a turn mid-flight:
              nothing is written and your words come back to you.
            </p>
          </Section>

          <Section kicker="time" title="Skipping, montages, and the clock">
            <p>
              Events fire against <strong style={{ color: "var(--text-hi)" }}>in-world time</strong>, not the turn counter. "In two
              days" means two days on the calendar, however many fast conversational turns you take in between.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Let the world turn</strong> skips hours or days: drives advance, rumours
              spread, clocks fill and fire, bodies heal, and you return to whatever it became.
            </p>
            <p>
              <strong style={{ color: "var(--text-hi)" }}>Direct the montage</strong> is the aimed version. Say what should be true
              by the end — <em>"thirty days, we move in together, adopt two cats, argue about money"</em> — and the engine
              writes the middle in beats, then scores itself on what actually landed.
            </p>
          </Section>

          <Section kicker="the people" title="They are not descriptions">
            <p>
              Each character carries memories stamped with a time and a place, a stack of up to three things they want,
              traits they are acquiring from what you do to them, and a private read of you that can simply be wrong.
            </p>
            <p>
              New people start as <strong style={{ color: "var(--text-hi)" }}>strangers</strong> — no warmth, no relationship, no
              prior claim on you — so you get real introductions. Bonds are labelled and can be several things at once
              (a boss <em>and</em> a girlfriend). Antagonists are allowed to stay antagonists; nothing converges on everyone
              turning out good.
            </p>
            <p>
              Follow someone (the eye toggle in Cast) and they keep wanting things offscreen. Give them{" "}
              <strong style={{ color: "var(--text-hi)" }}>a week</strong> — a shift, a watch, a market day — and they leave when they
              have to, tell you they are free until five, and pay for the night that kept them out.
            </p>
          </Section>

          <Section kicker="pictures" title="Portraits and scenes">
            <p>
              Every character can carry a portrait, and any turn can be illustrated from its own prose — by hand from
              the ⋯ menu, or automatically after every turn.
            </p>
            <p>
              Set <strong style={{ color: "var(--text-hi)" }}>Art direction</strong> once in Tuning — <em>"muted painterly
              chiaroscuro"</em>, <em>"90s cel anime"</em>, <em>"gritty photoreal"</em> — and everything obeys it. Portraits are
              built from the whole character, not just a face, and are then handed back as reference when a scene is
              painted, so the cast keeps the same faces from turn to turn.
            </p>
            <p>
              Point the image slot at a <Kbd>local/…</Kbd> id and pictures are free and unlimited. On a cloud model
              they are a few cents each, which is why painting every turn is off by default.
            </p>
          </Section>

          <Section kicker="cost & models" title="What you are spending">
            <p>
              Weft runs entirely in your browser and calls models with your own key. Four model slots live in
              <strong style={{ color: "var(--text-hi)" }}> Tuning → Models</strong>: the narrator writes the prose, the rest do the
              bookkeeping and the small passes. Point them at a local server (KoboldCpp, llama.cpp, LM Studio, Ollama)
              and nothing ever leaves your machine.
            </p>
            <p>
              The <strong style={{ color: "var(--text-hi)" }}>Chronicle</strong> shows a running token count and flags a premium
              narrator, so a large bill cannot creep up on you. <strong style={{ color: "var(--text-hi)" }}>Lean mode</strong> and a{" "}
              <strong style={{ color: "var(--text-hi)" }}>token budget</strong> (Tuning) roughly halve a turn if you need them to.
            </p>
          </Section>

          <Section kicker="your saves" title="They live in this browser">
            <p>
              Nothing is uploaded and there is no account. Clearing site data deletes your worlds. Export anything you
              care about from <strong style={{ color: "var(--text-hi)" }}>Tuning → Export</strong> — the file imports back from the
              library, and the paste option is there for phones.
            </p>
          </Section>

          <div className="text-[12px] italic pb-4" style={{ color: "var(--text-lo)" }}>
            Every screen also explains itself — tap the <strong>?</strong> in the title bar at any time.
          </div>
        </div>
      </motion.div>
    </div>
  );
}
