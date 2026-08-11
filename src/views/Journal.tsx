import React, { useMemo, useState } from "react";
import { ScrollText, HandshakeIcon, CircleHelp, Users2 } from "lucide-react";
import { api, type ClientSave } from "../lib/api";

/**
 * The PLAYER JOURNAL — a near-zero-LLM view derived entirely from state the engine already tracks:
 * the promise ledger, the fact ledger (with provenance), edges, and open threads. It is the
 * player's-eye answer to "where do I stand?" — what I've sworn and to whom, who owes me, what I know
 * about people and how I came to know it, and what's still hanging open.
 *
 * It used to be strictly read-only, and the promise ledger is the one part of it that could not
 * afford to be. Promises are opened by the bookkeeper and closed by the bookkeeper, and it misses:
 * one save carried "Lucia will walk Rabi into the cookshop and stay as his guide" as OPEN for twenty
 * turns after she had walked him into the cookshop, and "Payment for lodgings at five asses a night"
 * — a standing arrangement with no moment that could ever be the keeping of it — for seventeen. Both
 * sat in the player's journal as jobs still owed and went to the bookkeeper every turn as live
 * commitments. So the ledger takes three buttons.
 */
export default function Journal({ save, onSave }: { save: ClientSave; onSave?: (s: ClientSave) => void }) {
  const nameOf = (id: string) => id === "char_player" ? "You" : save.characters[id]?.name ?? "someone";

  const promises = save.world.promises ?? [];
  const myWord = promises.filter((p) => p.from === "char_player");
  const owedToMe = promises.filter((p) => p.to === "char_player");

  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const settle = async (id: string, outcome: "kept" | "broken" | "retired", text: string) => {
    const ask = outcome === "retired"
      ? `Retire "${text}"?\n\nIt leaves the ledger and changes nothing between anyone. Use this for a standing arrangement, or something the story has moved past.`
      : `Mark "${text}" as ${outcome}?\n\nThe relationship moves and the other person will remember it — the same as if the engine had noticed.`;
    if (!confirm(ask)) return;
    setBusy(id);
    try {
      const r = await api.settlePromise(save.id, id, outcome);
      onSave?.(r.save);
      setNote(r.log);
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

  const weightLabel = (w: number) => w === 3 ? "a vow" : w === 2 ? "a commitment" : "a small favor";
  const statusStyle = (s: string) =>
    s === "kept" ? { color: "var(--good, #6b9e78)" } :
    s === "broken" ? { color: "var(--bad, #b56c6c)" } :
    { color: "var(--text-lo)" };

  /** An open promise, with the three ways out of it. A promise the player considers finished and the
   *  engine does not is the exact case this exists for, so the age is shown: it is the only signal
   *  that separates "just made" from "the engine has stopped noticing this". */
  const PromiseRow = ({ p, who }: { p: (typeof promises)[number]; who: string }) => {
    const age = (save.world.current_turn ?? 0) - (p.made_turn ?? 0);
    const stale = p.status === "open" && age >= 8;
    return (
      <div className="py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[12.5px]">
            <span style={{ color: "var(--text-lo)" }}>{who} — </span>{p.text}
            <span className="text-[10.5px] ml-1.5" style={{ color: "var(--text-lo)" }}>({weightLabel(p.weight)})</span>
          </div>
          <div className="text-[11px] uppercase tracking-wide shrink-0" style={statusStyle(p.status)}>
            {p.status === "open"
              ? (p.due_time ? `due ${p.due_time}` : stale ? `open · ${age} turns` : "open")
              : p.status}
          </div>
        </div>
        {/* REAL BUTTONS. The first version of this row was 9.5px text at 60% opacity with no border
            and no background, and it was reported as not being there at all — which is the same
            failure .btn-sm was added to fix ("a row of buttons rendered as a row of plain text").
            These are the point of the screen; they get to look like something you can press. */}
        {p.status === "open" && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {([["kept", "It was done — the relationship moves and they remember it"],
               ["broken", "It was not done — the relationship takes the cost"],
               ["retired", "Take it off the ledger with no consequence to anyone"]] as const).map(([o, title]) => (
              <button key={o} disabled={busy === p.id} className="btn-sm" title={title}
                style={o === "kept" ? { borderColor: "var(--good, #6b9e78)", color: "var(--good, #6b9e78)" }
                     : o === "broken" ? { borderColor: "var(--bad, #b56c6c)", color: "var(--bad, #b56c6c)" }
                     : { borderColor: "var(--line)", color: "var(--text-mid)" }}
                onClick={() => settle(p.id, o, p.text)}
              >{o}</button>
            ))}
            {stale && <span className="text-[10px] ml-0.5" style={{ color: "var(--text-lo)" }}>open since turn {p.made_turn}</span>}
          </div>
        )}
        {p.status !== "open" && p.settled_by_hand && (
          <div className="text-[9.5px] mt-0.5" style={{ color: "var(--text-lo)" }}>closed by hand{p.settled_turn ? ` on turn ${p.settled_turn}` : ""}</div>
        )}
      </div>
    );
  };

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

  // what YOU know about each person — the player's own fact ledger, grouped by whom it concerns
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
        <span className="text-[11px] ml-2" style={{ color: "var(--text-lo)" }}>where you stand — drawn from what's actually happened, nothing invented</span>
      </div>

      {/* ── PROMISES ── */}
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
            {myWord.map((p) => <PromiseRow key={p.id} p={p} who={`to ${nameOf(p.to)}`} />)}
          </div>
        )}

        {owedToMe.length > 0 && (
          <div>
            <div className="text-[11px] mb-1" style={{ color: "var(--text-lo)" }}>Promises made to you</div>
            {owedToMe.map((p) => <PromiseRow key={p.id} p={p} who={nameOf(p.from)} />)}
          </div>
        )}

        {note && <div className="text-[11.5px] mt-2" style={{ color: "var(--text-mid)" }}>{note}</div>}
      </section>

      {/* ── PEOPLE & WHAT YOU KNOW ── */}
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
                <span className="text-[11px]" style={{ color: "var(--text-lo)" }}>{feel(p.warmth, p.trust)}{aboutThem.length ? ` · ${aboutThem.length} known` : ""}</span>
              </button>
              {open && aboutThem.length > 0 && (
                <div className="mt-1.5 pl-3">
                  {aboutThem.map((f, i) => (
                    <div key={i} className="text-[12px] py-0.5" style={{ color: "var(--text-mid)" }}>
                      {f.content}
                      {sourceLabel((f as any).source) && <span className="text-[10px] ml-1.5" style={{ color: "var(--text-lo)" }}>— {sourceLabel((f as any).source)}</span>}
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

      {/* ── OPEN LOOPS ── */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <CircleHelp size={14} style={{ color: "var(--text-mid)" }} />
          <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-mid)" }}>Open loops</h3>
        </div>
        {threads.length === 0 && <div className="text-[12.5px]" style={{ color: "var(--text-lo)" }}>Nothing hanging — the water's still.</div>}
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
