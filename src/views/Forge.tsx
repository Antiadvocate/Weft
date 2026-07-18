import React, { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft, Hammer } from "lucide-react";
import { api, type ClientSave } from "../lib/api";

const SPARKS = [
  "A lighthouse town where the keeper has been dead three weeks and no one will say it",
  "A caravan crossing salt flats, water for nine days, eleven people",
  "A monastery that takes in anyone — and a stranger arrives at lamplight",
  "A river port the week the fish stopped coming",
];

export default function Forge({ onBack, onCreated }: {
  onBack: () => void;
  onCreated: (s: ClientSave) => void;
}) {
  const [seed, setSeed] = useState("");
  const [destination, setDestination] = useState("");
  const [destTurns, setDestTurns] = useState("");
  const [model, setModel] = useState("deepseek/deepseek-chat-v3-0324");
  const [grounded, setGrounded] = useState(false);
  const [tone, setTone] = useState("");
  const [chronicle, setChronicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!seed.trim() || busy) return;
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
      onCreated(await api.forge(fullSeed, m || undefined, budget || undefined, grounded, seedThreads.length ? seedThreads : undefined, tone.trim() || undefined));
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
          One idea. The engine builds the place, the people, their grudges, their clocks. One LLM call, then the world runs itself.
        </div>

        <textarea className="field" rows={4} placeholder="A fishing village the winter the ice came early…"
          value={seed} onChange={(e) => setSeed(e.target.value)} />

        <div className="flex flex-wrap gap-1.5 mt-3">
          {SPARKS.map((s) => (
            <button key={s} className="chip text-left" style={{ textTransform: "none", letterSpacing: 0 }}
              onClick={() => setSeed(s)}>
              {s.length > 44 ? s.slice(0, 43) + "…" : s}
            </button>
          ))}
        </div>

        <div className="mt-5">
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
                    unrelated threads fall away. You choose how you get there, not whether you arrive.</>
                  : <>With no number the ending just pulls. The story can go on past it, or never reach it.</>}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Genre &amp; tone <span style={{ opacity: 0.6 }}>(optional — sets the register)</span>
          </div>
          <input className="field" type="text"
            placeholder={"e.g. action-horror survival, lethal and fast, romance under threat"}
            value={tone} onChange={(e) => setTone(e.target.value)} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            The key the whole story is written in. Set it and the world, threat, and prose are all built and rendered to match — no drifting into a quiet character study when you wanted horror. Leave blank to let the forge infer it from your seed.
          </div>
        </div>

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>
            Chronicle threads — story beats to seed <span style={{ opacity: 0.6 }}>(optional)</span>
          </div>
          <textarea className="field" rows={4}
            placeholder={"One beat per line. Title — optional detail.\nThe Rite of Voidbirth cult is smuggling artifacts through the Expanse\nAn old debt to Rogue Trader Vaicis comes due\nThe ship's Navigator is slowly going mad"}
            value={chronicle} onChange={(e) => setChronicle(e.target.value)} />
          <div className="text-[11.5px] leading-relaxed mt-1.5" style={{ color: "var(--text-lo)" }}>
            Set the plot points you want in play. Each becomes an active thread the world draws from, so what emerges is anchored to your intent instead of invented cold — the forge builds the cast and places so these are primed to happen. One per line; add "— detail" after a title to say more. You can always ignore them.
          </div>
        </div>

        <div className="mt-4">
          <div className="font-mono text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-lo)" }}>Forge model (OpenRouter id — pick the smith)</div>
          <input className="field" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
            value={model} onChange={(e) => setModel(e.target.value)} />
          <button className="chip mt-2.5" onClick={() => setGrounded((v) => !v)}
            style={grounded ? { color: "var(--accent)", borderColor: "var(--accent-glow)", background: "var(--accent-soft)" } : undefined}>
            {grounded ? "◉" : "○"} ground with web search
          </button>
          <div className="text-[11px] italic mt-1.5" style={{ color: "var(--text-lo)" }}>
            The forge searches the web while building, so worlds seeded from real media, places, or history come back canon-accurate. Add ((exact topic)) anywhere in your seed to aim the search precisely; otherwise it uses the seed itself. Costs a little more.
          </div>
        </div>

        {error && (
          <div className="card p-3 mt-4 font-mono text-[12px]" style={{ color: "var(--danger)", borderColor: "rgba(199,81,70,.4)" }}>
            {error}
          </div>
        )}

        <motion.button className="btn btn-accent w-full mt-5" style={{ height: 50 }}
          whileTap={{ scale: 0.97 }} onClick={go} disabled={busy || !seed.trim()}>
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
