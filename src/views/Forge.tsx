import React, { useRef, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, BookOpen, FileText, Hammer, X } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import { ModelPicker } from "./ModelPicker";
import { DEFAULT_MODELS } from "../engine/types";
import { guidesOff, setGuidesOff } from "../lib/tour";
import { sampleSource } from "../engine/source";

const SPARKS = [
  "A lighthouse town where the keeper has been dead three weeks and no one will say it",
  "A caravan crossing salt flats, water for nine days, eleven people",
  "A monastery that takes in anyone — and a stranger arrives at lamplight",
  "A river port the week the fish stopped coming",
];

export default function Forge({ onBack, onCreated, onGuide }: {
  onBack: () => void;
  onCreated: (s: ClientSave) => void;
  /** Opens the full primer. Optional so the Forge still mounts anywhere it is used bare. */
  onGuide?: () => void;
}) {
  const [seed, setSeed] = useState("");
  const [destination, setDestination] = useState("");
  const [destTurns, setDestTurns] = useState("");
  const [model, setModel] = useState(DEFAULT_MODELS.forge_model);
  const [grounded, setGrounded] = useState(false);
  const [tone, setTone] = useState("");
  const [chronicle, setChronicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A TEXT TO START INSIDE: a chapter, a setting document, a story bible. Sampled before it is sent,
  // never truncated — see engine/source.ts.
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [pasting, setPasting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sample = React.useMemo(() => (source ? sampleSource(source.text) : null), [source]);
  const sampleNote = sample
    ? `${sample.total.toLocaleString()} characters. ${sample.sampled
      ? `Too long to send whole, so ${sample.used} evenly spaced excerpts from ${sample.parts} parts go in, covering the opening, the middle and the end.`
      : "It goes in whole."}`
    : "";
  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setError("That file is over 20 MB. Use a plain-text export of the part you want."); return; }
    const text = await f.text();
    // A binary file read as text is mostly control characters; refuse it rather than send noise.
    const junk = (text.slice(0, 4000).match(/[\u0000-\u0008\u000E-\u001F]/g) ?? []).length;
    if (junk > 40) { setError(`${f.name} isn't plain text. Save it as .txt or .md first.`); return; }
    setError(null);
    setPasting(false);
    setSource({ name: f.name, text });
  };
  // The veteran's escape hatch, put where a new player is guaranteed to stand at least once.
  const [veteran, setVeteran] = useState(() => guidesOff());

  const go = async () => {
    if ((!seed.trim() && !source?.text.trim()) || busy) return;
    setBusy(true); setError(null);
    try {
      const m = model.trim();
      // The destination is optional. When given, state it to the Forge as the story's stated ending;
      // when blank the Forge leaves world_bible.destination empty and the story stays open.
      const fullSeed = destination.trim()
        ? `${seed.trim()}\n\nSTATED ENDING (the destination this story is written toward): ${destination.trim()}`
        : seed.trim();
      const budget = destination.trim() ? Math.max(0, parseInt(destTurns, 10) || 0) : 0;
      const seedThreads = chronicle.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
        // "Title — description" or "Title: description" or just "Title"; leading "- " and "1." stripped
        const clean = line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "");
        const m = clean.match(/^(.*?)\s*(?:—|--|:)\s*(.+)$/);
        return m ? { title: m[1].trim(), description: m[2].trim() } : { title: clean };
      }).filter((t) => t.title);
      onCreated(await api.forge(fullSeed, m || undefined, budget || undefined, grounded, seedThreads.length ? seedThreads : undefined, tone.trim() || undefined, source?.text.trim() ? source : undefined));
    } catch (e: any) {
      setError(e.message ?? "world generation failed");
      setBusy(false);
    }
  };

  return (
    <div className="scroll-y h-full px-5 pb-10 pt-3">
      <button className="chip mb-5" onClick={onBack}><ArrowLeft size={11} /> library</button>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="font-display text-[22px] mb-1.5">Seed a world.</div>
        <div className="text-[13.5px] leading-relaxed mb-5" style={{ color: "var(--text-mid)" }}>
          Start from one idea. One LLM call builds the place, the characters, their conflicts and the faction timers. After that the world runs on its own.
        </div>

        <textarea className="field" rows={4} data-tour="forge-seed" placeholder="A fishing village the winter the ice came early…"
          value={seed} onChange={(e) => setSeed(e.target.value)} />

        <div className="flex flex-wrap gap-1.5 mt-3" data-tour="forge-sparks">
          {SPARKS.map((s) => (
            <button key={s} className="chip text-left" style={{ textTransform: "none", letterSpacing: 0 }}
              onClick={() => setSeed(s)}>
              {s.length > 44 ? s.slice(0, 43) + "…" : s}
            </button>
          ))}
        </div>

        <div className="mt-5" data-tour="forge-source">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Start from a text <span style={{ opacity: 0.6 }}>(optional)</span>
          </div>
          {pasting ? (
            <>
              <textarea className="field" rows={6} autoFocus value={source?.text ?? ""}
                placeholder="Paste a chapter, a setting document or a story bible…"
                onChange={(e) => setSource(e.target.value.trim() ? { name: "pasted text", text: e.target.value } : null)}
                onBlur={(e) => { if (!e.target.value.trim()) setPasting(false); }} />
              {sample && (
                <div className="flex items-start gap-2 mt-1.5">
                  <div className="text-[11.5px] leading-relaxed flex-1" style={{ color: "var(--text-lo)" }}>{sampleNote}</div>
                  <button className="chip shrink-0" aria-label="remove the text" onClick={() => { setSource(null); setPasting(false); }}><X size={11} /></button>
                </div>
              )}
            </>
          ) : source ? (
            <div className="card p-3 flex items-start gap-2.5">
              <FileText size={15} className="shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] truncate" style={{ color: "var(--text-hi)" }}>{source.name}</div>
                <div className="text-[11.5px] leading-relaxed mt-0.5" style={{ color: "var(--text-lo)" }}>{sampleNote}</div>
              </div>
              <button className="chip shrink-0" aria-label="remove the text" onClick={() => { setSource(null); setPasting(false); }}><X size={11} /></button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button className="chip" onClick={() => fileRef.current?.click()}><FileText size={11} /> choose a file</button>
              <button className="chip" onClick={() => setPasting(true)}>paste text</button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".txt,.md,.markdown,.text,text/plain,text/markdown" className="hidden"
            onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            The world is built from the text: its people, places, relationships and rules, under the names it uses. Your idea above still says who you are and where you come in; leave it blank to arrive as a newcomer. Plain text or Markdown.
          </div>
        </div>

        <div className="mt-5" data-tour="forge-destination">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Destination — where this story ends <span style={{ opacity: 0.6 }}>(optional)</span>
          </div>
          <textarea className="field" rows={2}
            placeholder="He learns to feed himself through winter and builds a shelter that holds…"
            value={destination} onChange={(e) => setDestination(e.target.value)} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            Name the ending and every scene is steered toward it. Leave it blank for an open world.
          </div>
          {!!destination.trim() && (
            <div className="mt-3">
              <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
                Turn budget <span style={{ opacity: 0.6 }}>(blank = no clock)</span>
              </div>
              <input className="field" inputMode="numeric" placeholder="60"
                style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
                value={destTurns} onChange={(e) => setDestTurns(e.target.value.replace(/[^0-9]/g, ""))} />
              <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
                {destTurns.trim()
                  ? <>The story ends after {destTurns} turns. Everything before that moves toward the ending; as the turns run down,
                    unrelated threads fall away. You decide how the story gets there, but it will get there.</>
                  : <>With no turn count, the ending only steers. The story can go past it or never reach it.</>}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4" data-tour="forge-tone">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Genre &amp; tone <span style={{ opacity: 0.6 }}>(optional — sets the register)</span>
          </div>
          <input className="field" type="text"
            placeholder={"e.g. action-horror survival, lethal and fast, romance under threat"}
            value={tone} onChange={(e) => setTone(e.target.value)} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            The genre and tone of the whole story. The world, the threats and the prose are all built to match it, so a horror idea stays horror. Leave it blank to let the world builder work it out from your idea.
          </div>
        </div>

        <div className="mt-4" data-tour="forge-threads">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Storylines: events you want the story to set up <span style={{ opacity: 0.6 }}>(optional)</span>
          </div>
          <textarea className="field" rows={4}
            placeholder={"One per line, as a title with optional detail after a dash.\nThe Rite of Voidbirth cult is smuggling artifacts through the Expanse\nAn old debt to Rogue Trader Vaicis comes due\nThe ship's Navigator is slowly going mad"}
            value={chronicle} onChange={(e) => setChronicle(e.target.value)} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            Set up the plot points you want in play. Each one becomes an active storyline the world draws on, so the story starts from what you asked for instead of from nothing, and the world builder makes the cast and places so these are ready to happen. One per line; add "— detail" after a title to say more. You can always ignore them.
          </div>
        </div>

        <div className="mt-4" data-tour="forge-model">
          {/* THE SMITH, FROM THE LIVE LIST. This was a bare text input holding a hardcoded model id,
              which meant that the day that id left OpenRouter the first thing a new player met was
              a forge that failed and no way to fix it but to know another id by heart and type it.
              Same picker as Tuning: live list, searchable, local models first, custom ids still
              accepted by typing one in. */}
          <ModelPicker label="World-building model (the one that builds the world)" value={model} onChange={setModel} />
          <button className="chip mt-1.5" data-tour="forge-web" onClick={() => setGrounded((v) => !v)}
            style={grounded ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
            {grounded ? "◉" : "○"} ground with web search
          </button>
          <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
            The world builder searches the web while it works, so worlds based on real media, places or history come back accurate to the source. Put ((exact topic)) anywhere in your idea to aim the search precisely; otherwise it searches for the idea itself. It costs a little more.
          </div>
        </div>

        {/* ── FOR PEOPLE WHO ALREADY KNOW ── The guides open themselves once per screen, which is
            right the first time and an obstacle every time after. This is the switch, sitting on
            the one screen everybody passes through, next to the door to the long version. */}
        <div className="card p-3 mt-5 flex items-start gap-3" data-tour="forge-veteran">
          <button
            className="shrink-0 mt-0.5 rounded flex items-center justify-center"
            role="checkbox" aria-checked={veteran}
            style={{ width: 18, height: 18,
              border: `1px solid ${veteran ? "var(--accent)" : "var(--line-strong)"}`,
              background: veteran ? "var(--accent)" : "transparent",
              color: "var(--ink-0)", fontSize: 12, lineHeight: 1 }}
            onClick={() => { const v = !veteran; setVeteran(v); setGuidesOff(v); }}>
            {veteran ? "✓" : ""}
          </button>
          <div className="min-w-0 flex-1">
            <button className="text-left block w-full"
              onClick={() => { const v = !veteran; setVeteran(v); setGuidesOff(v); }}>
              <div className="text-[13px]" style={{ color: "var(--text-hi)" }}>I'm used to this — skip the guides</div>
              <div className="text-[11.5px] leading-relaxed mt-0.5" style={{ color: "var(--text-lo)" }}>
                No screen opens its own walkthrough. The <strong>?</strong> in the title bar still brings one back
                whenever you want it, and this switch also lives in Tuning.
              </div>
            </button>
            {onGuide && (
              <button className="chip mt-2" onClick={onGuide}>
                <BookOpen size={11} /> cheat sheet
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="card p-3 mt-4 font-mono text-[12px]" style={{ color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" }}>
            {error}
          </div>
        )}

        <motion.button className="btn btn-accent w-full mt-5" style={{ height: 50 }} data-tour="forge-go"
          whileTap={{ scale: 0.97 }} onClick={go} disabled={busy || (!seed.trim() && !source?.text.trim())}>
          <Hammer size={15} />
          {busy ? "forging — this takes a minute…" : "Forge the world"}
        </motion.button>
        {busy && (
          <div className="font-mono text-[11px] text-center mt-3">
            <span className="shimmer">building the people, places, and stakes…</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}
