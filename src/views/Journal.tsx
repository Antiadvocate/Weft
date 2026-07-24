
import React, { useMemo, useState } from "react";
import { ScrollText, HandshakeIcon, CircleHelp, Users2 } from "lucide-react";
import type { ClientSave } from "../lib/api";

/**
 * The PLAYER JOURNAL â€” a read-only, zero-LLM view derived entirely from state the engine already
 * tracks: the promise ledger, the fact ledger (with provenance), edges, and open threads. It is the
 * player's-eye answer to "where do I stand?" â€” what I've sworn and to whom, who owes me, what I know
 * about people and how I came to know it, and what's still hanging open. Nothing here writes; it only
 * reflects. This is the payoff screen for provenance + promises.
 */
export default function Journal({ save }: { save: ClientSave }) {
  const nameOf = (id: string) => id === "char_player" ? "You" : save.characters[id]?.name ?? "someone";

  const promises = save.world.promises ?? [];
  const myWord = promises.filter((p) => p.from === "char_player");
  const owedToMe = promises.filter((p) => p.to === "char_player");

  const weightLabel = (w: number) => w === 3 ? "a vow" : w === 2 ? "a commitment" : "a small favor";
  const statusStyle = (s: string) =>
    s === "kept" ? { color: "var(--good, #6b9e78)" } :
    s === "broken" ? { color: "var(--bad, #b56c6c)" } :
    { color: "var(--text-lo)" };

  const sourceLabel = (s: any): string => {
    if (!s || s === "witnessed") return "saw it firsthand";
    if (s === "rumor") return "heard it as a rumor";
    if (s === "inferred") return "learned while away";
    if (typeof s === "object" && s.told_by) return `${nameOf(s.told_by)} told you`;
    return "";
  };

  // people you have any relationship with, sorted by how much they matter (|warmth|+|trust|)
  const people = useMemo(() => {
    return (save.world.edges ?? [])
      .filter((e) => e.to === "char_player" && e.from !== "char_player" && save.characters[e.from] && save.characters[e.from].status !== "dead" && save.characters[e.from].status !== "departed")
      .map((e) => ({
        id: e.from, name: save.characters[e.from].name, warmth: e.warmth, trust: e.trust,
        facts: (save.memory[e.from]?.facts ?? []),
      }))
      .sort((a, b) => (Math.abs(b.warmth) + Math.abs(b.trust)) - (Math.abs(a.warmth) + Math.abs(a.trust)));
  }, [save]);

  // what YOU know about each person â€” the player's own fact ledger, grouped by whom it concerns
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const playerFacts = save.memory["char_player"]?.facts ?? [];

  const threads = (save.world.threads ?? []).filter((t) => t.status === "active").sort((a, b) => b.tension - a.tension);

  const feel = (warmth: number, trust: number) => {
    const w = warmth >= 45 ? "close to you" : warmth >= 20 ? "warm" : warmth >= 5 ? "friendly" : warmth > -5 ? "neutral" : warmth > -20 ? "cool" : warmth > -45 ? "hostile" : "an enemy";
    const t = trust >= 45 ? "trusts you" : trust >= 20 ? "starting to trust you" : trust > -5 ? "unsure of you" : trust > -25 ? "wary" : "distrustful";
    return `${w}, ${t}`;
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6" style={{ color: "var(--text-hi)" }}>
      <div className="flex items-center gap-2 mb-5">
        <ScrollText size={18} style={{ color: "var(--text-mid)" }} />
        <h2 className="text-lg font-semibold">Journal</h2>
        <span className="text-[11px] ml-2" style={{ color: "var(--text-lo)" }}>where you stand â€” drawn from what's actually happened, nothing invented</span>
      </div>

      {/* â”€â”€ PROMISES â”€â”€ */}
      <section className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <HandshakeIcon size={14} style={{ color: "var(--text-mid)" }} />
          <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Your word</h3>
        </div>
        {myWord.length === 0 && owedToMe.length === 0 && (
          <div className="text-[12.5px]" style={{ color: "var(--text-lo)" }}>You haven't made or been made any promises yet. What you swear will be remembered here.</div>
        )}

        {myWord.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] mb-1" style={{ color: "var(--text-lo)" }}>Promises you made</div>
            {myWord.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                <div className="text-[12.5px]">
                  <span style={{ color: "var(--text-lo)" }}>to {nameOf(p.to)} â€” </span>{p.text}
                  <span className="text-[10.5px] ml-1.5" style={{ color: "var(--text-lo)" }}>({weightLabel(p.weight)})</span>
                </div>
                <div className="text-[11px] uppercase tracking-wide shrink-0" style={statusStyle(p.status)}>
                  {p.status === "open" ? (p.due_time ? `due ${p.due_time}` : "open") : p.status}
                </div>
              </div>
            ))}
          </div>
        )}

        {owedToMe.length > 0 && (
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--text-lo)" }}>Promises made to you</div>
            {owedToMe.map((p) => (
              <div key={p.id} className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                <div className="text-[12.5px]">
                  <span style={{ color: "var(--text-lo)" }}>{nameOf(p.from)} â€” </span>{p.text}
                  <span className="text-[10.5px] ml-1.5" style={{ color: "var(--text-lo)" }}>({weightLabel(p.weight)})</span>
                </div>
                <div className="text-[11px] uppercase tracking-wide shrink-0" style={statusStyle(p.status)}>
                  {p.status === "open" ? (p.due_time ? `due ${p.due_time}` : "owed") : p.status}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* â”€â”€ PEOPLE & WHAT YOU KNOW â”€â”€ */}
      <section className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <Users2 size={14} style={{ color: "var(--text-mid)" }} />
          <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>People</h3>
        </div>
        {people.length === 0 && <div className="text-[12.5px]" style={{ color: "var(--text-lo)" }}>No one has formed a view of you yet.</div>}
        {people.map((p) => {
          // facts YOU hold that mention this person
          const aboutThem = playerFacts.filter((f) => f.content.toLowerCase().includes(p.name.toLowerCase()));
          const open = openPerson === p.id;
          return (
            <div key={p.id} className="py-1.5" style={{ borderBottom: "1px solid var(--ink-2)" }}>
              <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpenPerson(open ? null : p.id)}>
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="text-[11px]" style={{ color: "var(--text-lo)" }}>{feel(p.warmth, p.trust)}{aboutThem.length ? ` Â· ${aboutThem.length} known` : ""}</span>
              </button>
              {open && aboutThem.length > 0 && (
                <div className="mt-1.5 pl-3">
                  {aboutThem.map((f, i) => (
                    <div key={i} className="text-[12px] py-0.5" style={{ color: "var(--text-mid)" }}>
                      {f.content}
                      {sourceLabel((f as any).source) && <span className="text-[10px] ml-1.5" style={{ color: "var(--text-lo)" }}>â€” {sourceLabel((f as any).source)}</span>}
                    </div>
                  ))}
                </div>
              )}
              {open && aboutThem.length === 0 && (
                <div className="mt-1 pl-3 text-[11.5px]" style={{ color: "var(--text-lo)" }}>You know them by presence, but haven't learned any hard facts about them yet.</div>
              )}
            </div>
          );
        })}
      </section>

      {/* â”€â”€ OPEN LOOPS â”€â”€ */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <CircleHelp size={14} style={{ color: "var(--text-mid)" }} />
          <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Open loops</h3>
        </div>
        {threads.length === 0 && <div className="text-[12.5px]" style={{ color: "var(--text-lo)" }}>Nothing hanging â€” the water's still.</div>}
        {threads.map((t) => (
          <div key={t.id} className="flex items-baseline justify-between gap-3 py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
            <div className="text-[12.5px]">{t.title}</div>
            <div className="text-[10.5px] uppercase tracking-wide shrink-0" style={{ color: t.tension >= 7 ? "var(--bad, #b56c6c)" : "var(--text-lo)" }}>
              {t.tension >= 8 ? "urgent" : t.tension >= 5 ? "live" : "simmering"}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

