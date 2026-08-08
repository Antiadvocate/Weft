import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDownToLine, Braces, Brush, DoorOpen, Eye, EyeOff, Fingerprint, Heart, Mic, MoreHorizontal, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { api, type ClientSave } from "../lib/api";
import { splitLines } from "../engine/turn";
import { nice, niceCap } from "../lib/format";
import { CuspGlyph } from "../lib/charts";
import { attractionWord } from "../engine/desire";

function opennessLabel(r: number): string {
  if (r <= -7) return "clenched shut";
  if (r <= -3) return "guarded";
  if (r < 3) return "steady";
  if (r < 7) return "open";
  return "wide open";
}

export default function Cast({ save, setSave, initialSel }: { save: ClientSave; setSave: (s: ClientSave) => void; initialSel?: string | null }) {
  const [sel, setSel] = useState<string | null>(initialSel ?? null);
  const [showElsewhere, setShowElsewhere] = useState(true);
  const [showGone, setShowGone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [painting, setPainting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [embodyConfirm, setEmbodyConfirm] = useState(false);
  const [rawJson, setRawJson] = useState<string | null>(null);
  const [rawErr, setRawErr] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [embodying, setEmbodying] = useState(false);

  const toggleFollow = async (cid: string, on: boolean) => {
    setSave(await api.setTracked(save.id, cid, on));
  };
  const changeStatus = async (cid: string, action: "background" | "away" | "restore" | "central") => {
    setSave(await api.setCharacterStatus(save.id, cid, action));
  };

  const embody = async () => {
    if (!sel || embodying) return;
    setEmbodying(true);
    try {
      const s = await api.embody(save.id, sel);
      setSave(s); setSel(null); setEmbodyConfirm(false);
    } catch (e: any) { setImgErr(e.message); }
    finally { setEmbodying(false); }
  };
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [revoicing, setRevoicing] = useState(false);
  const [retraiting, setRetraiting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState({ name: "", age: "", background: "", life_history: "", appearance_facts: "", appearance_now: "", current_goal: "", core_traits: "", height_ft: "", height_in: "", weight_lb: "" });
  const [newFact, setNewFact] = useState("");
  const [factsBusy, setFactsBusy] = useState(false);
  const [blBusy, setBlBusy] = useState(false);
  const [ivQ, setIvQ] = useState("");
  const [ivBusy, setIvBusy] = useState(false);
  const [ivLog, setIvLog] = useState<{ q: string; a: string }[]>([]);
  const [ivErr, setIvErr] = useState("");

  useEffect(() => { setIvLog([]); setIvErr(""); setIvQ(""); setNewFact(""); setMenu(false); }, [sel]);

  const commitFacts = async (facts: { content: string; quote?: string }[]) => {
    if (!sel) return;
    setFactsBusy(true);
    try { setSave(await api.setFacts(save.id, sel, facts)); } finally { setFactsBusy(false); }
  };
  const ask = async () => {
    if (!sel || !ivQ.trim() || ivBusy) return;
    const q = ivQ.trim(); setIvQ(""); setIvBusy(true); setIvErr("");
    try {
      const { answer } = await api.interview(save.id, sel, q, ivLog);
      setIvLog((l) => [...l, { q, a: answer }]);
    } catch (e: any) { setIvErr(e.message ?? "interview failed"); }
    finally { setIvBusy(false); }
  };

  const startEdit = () => {
    if (!c) return;
    setDraft({
      name: c.name, age: String(c.age), background: c.background, life_history: c.life_history ?? "", appearance_facts: c.appearance_facts, appearance_now: c.appearance_now ?? "", height_ft: c.height_cm ? String(Math.floor(Math.round(c.height_cm / 2.54) / 12)) : "", height_in: c.height_cm ? String(Math.round(c.height_cm / 2.54) % 12) : "", weight_lb: c.weight_kg ? String(Math.round(c.weight_kg * 2.20462)) : "",
      current_goal: c.current_goal ?? "", core_traits: c.core_traits.join("\n"),
    });
    setEditing(true);
  };
  const commitEdit = async () => {
    if (!sel) return;
    const s = await api.edit(save.id, {
      characters: { [sel]: {
        name: draft.name.trim() || c!.name,
        age: Number(draft.age) || c!.age,
        background: draft.background,
        life_history: draft.life_history,
        appearance_facts: draft.appearance_facts,
        appearance_now: draft.appearance_now,
        height_cm: (Number(draft.height_ft) || Number(draft.height_in)) ? Math.round(((Number(draft.height_ft) || 0) * 12 + (Number(draft.height_in) || 0)) * 2.54) : undefined,
        weight_kg: Number(draft.weight_lb) ? Math.round(Number(draft.weight_lb) / 2.20462) : undefined,
        current_goal: draft.current_goal,
        // ONE PER LINE. Splitting on commas shreds any trait containing one, and the traits worth
        // writing all contain one: "Cries at commercials with dogs in them, and at songs she loved
        // in high school, and never at the thing that's actually breaking her heart" came back as
        // three fragments — and the fragment that carried the whole character was the one lost.
        core_traits: splitLines(draft.core_traits),
      } },
    });
    setSave(s); setEditing(false);
  };
  const paint = async () => {
    if (!sel || painting) return;
    setPainting(true); setImgErr(null);
    try { const { save: s } = await api.portrait(save.id, sel); setSave(s); }
    catch (e: any) { setImgErr(e.message); }
    finally { setPainting(false); }
  };
  const rescore = async () => {
    if (!sel || scoring) return;
    setScoring(true);
    try { await api.rescoreBeauty(save.id, [sel]); setSave(await api.save(save.id)); }
    catch { /* non-critical */ }
    finally { setScoring(false); }
  };
  const allIds = Object.keys(save.characters);
  const gone = (id: string) => { const st = save.characters[id]?.status; return st === "dead" || st === "departed"; };
  const present = new Set(save.world.present);
  const sceneIds = ["char_player", ...allIds.filter((id) => id !== "char_player" && present.has(id) && !gone(id))];
  const elsewhereIds = allIds.filter((id) => id !== "char_player" && !present.has(id) && !gone(id));
  const goneIds = allIds.filter((id) => id !== "char_player" && gone(id));

  const c = sel ? save.characters[sel] : null;
  const cond = sel ? save.condition[sel] : null;
  const mem = sel ? save.memory[sel] : null;
  // provenance → short human label for the GM "how do they know this?" view
  const sourceLabel = (s: any): string => {
    if (!s) return "";
    if (s === "witnessed") return "saw it";
    if (s === "rumor") return "heard a rumor";
    if (s === "inferred") return "offscreen";
    if (typeof s === "object" && s.told_by) return `told by ${save.characters[s.told_by]?.name ?? "someone"}`;
    return "";
  };
  const traits = sel ? save.traits[sel] ?? [] : [];
  // GM VIEW — this character's recent PRIVATE intents (the lie/hidden want the prose concealed).
  // Pulled from turn history, newest first. This is how the player verifies the intent system:
  // what xe actually meant vs. what the prose let show. Only meaningful when it diverges.
  const gmIntents = useMemo(() => {
    if (!sel) return [] as { turn: number; surface: string; truth: string; lying: boolean }[];
    const out: { turn: number; surface: string; truth: string; lying: boolean }[] = [];
    for (let i = save.history.length - 1; i >= 0 && out.length < 5; i--) {
      const hit = save.history[i].gm_intents?.find((g) => g.char_id === sel);
      if (hit) out.push({ turn: save.history[i].turn, surface: hit.surface, truth: hit.truth, lying: hit.lying });
    }
    return out;
  }, [sel, save.history]);
  const playerEdges = useMemo(
    () => (sel ? save.world.edges.filter((e) => e.from === sel) : []),
    [sel, save.world.edges]
  );

  return (
    <div className="scroll-y h-full px-4 pb-10 pt-3">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--accent)" }}>
        In the scene
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {sceneIds.map((id, i) => {
          const ch = save.characters[id];
          const p = save.condition[id]?.psyche;
          const isPlayer = id === "char_player";
          return (
            <motion.button key={id} className="card card-press p-3.5 text-left"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.25 }}
              onClick={() => setSel(id)}
              style={isPlayer ? { borderColor: "var(--accent-glow)" } : undefined}>
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ border: "1px solid var(--line)" }} />}
                  <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                </div>
                {!isPlayer && ch.tracked && <Eye size={11} style={{ color: "var(--accent)" }} className="shrink-0" />}
              </div>
              <div className="font-mono text-[10px] mt-1 truncate" style={{ color: "var(--text-lo)" }}>
                {isPlayer ? "you" : nice(ch.drive?.goal || ch.current_activity || ch.current_goal || "—")}
              </div>
              {p && (
                <div className="font-mono text-[10px] mt-1.5" style={{ color: "var(--text-mid)" }}>
                  {nice(p.mood)} · {isPlayer ? nice(p.state) : opennessLabel(p.relaxation)}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {elsewhereIds.length > 0 && (
        <>
          <button className="font-mono text-[10px] uppercase tracking-widest mt-5 mb-2 flex items-center gap-1.5"
            style={{ color: "var(--text-lo)" }} onClick={() => setShowElsewhere((v) => !v)}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: showElsewhere ? "rotate(90deg)" : "none" }}>▸</span>
            Elsewhere ({elsewhereIds.length})
          </button>
          {showElsewhere && (
            <div className="grid grid-cols-2 gap-2.5">
              {elsewhereIds.map((id, i) => {
                const ch = save.characters[id];
                const p = save.condition[id]?.psyche;
                return (
                  <motion.button key={id} className="card card-press p-3.5 text-left" style={{ opacity: 0.82 }}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 0.82, y: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.25 }}
                    onClick={() => setSel(id)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" style={{ border: "1px solid var(--line)" }} />}
                      <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                    </div>
                    <div className="font-mono text-[10px] mt-1 truncate" style={{ color: "var(--text-lo)" }}>
                      {ch.tracked && "● "}{nice(ch.drive?.goal || ch.current_activity || ch.current_goal || "—")}
                    </div>
                    {p && (
                      <div className="font-mono text-[10px] mt-1.5" style={{ color: "var(--text-mid)" }}>
                        {nice(p.mood)} · {opennessLabel(p.relaxation)}
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </>
      )}

      {goneIds.length > 0 && (
        <>
          <button className="font-mono text-[10px] uppercase tracking-widest mt-5 mb-2 flex items-center gap-1.5"
            style={{ color: "var(--text-lo)" }} onClick={() => setShowGone((v) => !v)}>
            <span style={{ display: "inline-block", transition: "transform .2s", transform: showGone ? "rotate(90deg)" : "none" }}>▸</span>
            Gone ({goneIds.length})
          </button>
          {showGone && (
            <div className="grid grid-cols-2 gap-2.5">
              {goneIds.map((id) => {
                const ch = save.characters[id];
                return (
                  <button key={id} className="card card-press p-3.5 text-left" style={{ opacity: 0.55 }} onClick={() => setSel(id)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {ch.portrait_url && <img src={ch.portrait_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0 grayscale" style={{ border: "1px solid var(--line)" }} />}
                      <div className="font-display text-[14.5px] truncate">{ch.name}</div>
                    </div>
                    <div className="font-mono text-[10px] mt-1" style={{ color: "var(--text-lo)" }}>
                      {ch.status === "dead" ? "dead" : "gone"}{ch.exit_note ? ` · ${ch.exit_note}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {c && cond && (
          <>
            <motion.div className="drawer-veil fixed inset-0 z-40"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSel(null)} />
            <motion.div className="drawer fixed bottom-0 left-0 right-0 z-50 max-h-[82dvh] flex flex-col"
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}>
              <div className="grab" />
              <div className="flex items-center justify-between px-5 py-2">
                <div className="flex items-center gap-3">
                  {c.portrait_url && <img src={c.portrait_url} alt="" onClick={() => setLightbox(c.portrait_url!)} className="w-16 h-16 rounded-xl object-cover cursor-pointer" style={{ border: "1px solid var(--line-strong)" }} />}
                  <div>
                    <div className="font-display text-[18px]">{c.name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--text-lo)" }}>
                      {c.age} · {c.intelligence}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 relative">
                  {/* Only the three controls used constantly stay on the strip. Everything else moved
                      into the overflow below — ten unlabeled glyphs in a row is not a toolbar, it's a
                      guessing game, and the destructive ones sat next to the harmless ones. */}
                  {sel !== "char_player" && (
                    <button onClick={() => toggleFollow(sel!, !c.tracked)} title={c.tracked ? "following — tap to unfollow" : "follow in the long game"}>
                      {c.tracked ? <Eye size={16} style={{ color: "var(--accent)" }} /> : <EyeOff size={16} style={{ color: "var(--text-lo)" }} />}
                    </button>
                  )}
                  <button onClick={editing ? () => setEditing(false) : startEdit} title="edit">
                    <Pencil size={16} style={{ color: editing ? "var(--accent)" : "var(--text-lo)" }} />
                  </button>
                  <button onClick={() => setMenu((m) => !m)} title="more">
                    <MoreHorizontal size={18} style={{ color: menu ? "var(--accent)" : "var(--text-lo)" }} />
                  </button>
                  <button onClick={() => { setSel(null); setEditing(false); setMenu(false); }} title="close">
                    <X size={18} style={{ color: "var(--text-lo)" }} />
                  </button>

                  {menu && (
                    <>
                      {/* click-anywhere-else to dismiss */}
                      <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                      <div className="absolute right-0 top-8 z-50 rounded-xl overflow-hidden"
                        style={{ background: "var(--ink-1)", border: "1px solid var(--line-strong)", minWidth: 232, boxShadow: "0 8px 28px rgba(0,0,0,0.28)" }}>
                        {(() => {
                          const npc = sel !== "char_player";
                          const alive = c.status !== "departed" && c.status !== "dead";
                          const Item = ({ icon, label, note, on, busy, danger }: any) => (
                            <button disabled={busy} onClick={() => { setMenu(false); on(); }}
                              className="w-full flex items-start gap-2.5 px-3 py-2 text-left"
                              style={{ borderBottom: "1px solid var(--ink-3)" }}>
                              <span className="mt-0.5 shrink-0">{icon}</span>
                              <span className="min-w-0">
                                <span className="block text-[13px]" style={{ color: danger ? "var(--danger)" : "var(--text-hi)" }}>
                                  {busy ? "working…" : label}
                                </span>
                                {note && <span className="block text-[10.5px] leading-snug" style={{ color: "var(--text-lo)" }}>{note}</span>}
                              </span>
                            </button>
                          );
                          const grey = { color: "var(--text-lo)" };
                          return (
                            <>
                              <Item icon={<Brush size={15} style={grey} />} label="Generate portrait" busy={painting} on={paint} />
                              <Item icon={<Braces size={15} style={grey} />} label="Raw edit" note="the full character JSON"
                                on={async () => { setRawErr(""); const raw = await api.getCharacterRaw(save.id, sel!); setRawJson(JSON.stringify(raw, null, 2)); }} />
                              <Item icon={<Fingerprint size={15} style={grey} />} label="Re-express core traits"
                                note="same person, described one level deeper — originals kept"
                                busy={retraiting}
                                on={async () => { setRetraiting(true); try { setSave(await api.retraitOne(save.id, sel!)); } catch { /* leave traits */ } finally { setRetraiting(false); } }} />
                              <Item icon={<Mic size={15} style={grey} />} label="Re-read their voice"
                                note="regenerate how they talk from the card, ignoring recent drift"
                                busy={revoicing}
                                on={async () => { setRevoicing(true); try { setSave(await api.refreshVoice(save.id, sel!)); } catch { /* leave voice */ } finally { setRevoicing(false); } }} />
                              <Item icon={<Heart size={15} style={grey} />} label="Re-score attractiveness"
                                note={typeof c.beauty === "number" ? `currently ${c.beauty} — recomputes from appearance` : "recomputes from appearance"}
                                busy={scoring} on={rescore} />
                              {npc && <Item icon={<Sparkles size={15} style={grey} />} label="Embody" on={() => setEmbodyConfirm(true)} />}
                              {npc && alive && c.central !== false && (
                                <Item icon={<ArrowDownToLine size={15} style={grey} />} label="Move to background"
                                  note="frees a central slot; the engine stops giving them full focus"
                                  on={() => changeStatus(sel!, "background")} />
                              )}
                              {npc && c.status === "departed" && (
                                <Item icon={<RotateCcw size={15} style={{ color: "var(--accent)" }} />} label="Bring back into the story"
                                  on={() => changeStatus(sel!, "restore")} />
                              )}
                              {npc && alive && (
                                <Item icon={<DoorOpen size={15} style={{ color: "var(--danger)" }} />} label="Send away" danger
                                  note="they leave the story and this scene — reversible from the Gone list"
                                  on={() => { if (confirm(`Send ${c.name} away for good? They leave the story and the current scene. You can bring them back later from the Gone list.`)) changeStatus(sel!, "away"); }} />
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {painting && <div className="px-5 pb-1 font-mono text-[10px]"><span className="shimmer">generating portrait…</span></div>}
              {imgErr && <div className="px-5 pb-1 font-mono text-[10px]" style={{ color: "var(--danger)" }}>{imgErr}</div>}

              <div className="scroll-y px-5 pb-6 space-y-4">
                {embodyConfirm && (
                  <div className="card p-4" style={{ borderColor: "var(--accent-glow)" }}>
                    <div className="font-display text-[15px] mb-1">Become {c.name}?</div>
                    <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>
                      You will inherit their memories, bonds, wounds, traits, and wants — all of it, as it stands.
                      {" "}{save.characters["char_player"]?.name} remains in the world, a person the world remembers.
                      This can be unraveled like any turn.
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button className="btn btn-accent flex-1" onClick={embody} disabled={embodying}>
                        {embodying ? "switching…" : "Become them"}
                      </button>
                      <button className="btn btn-ghost flex-1" onClick={() => setEmbodyConfirm(false)}>Stay</button>
                    </div>
                  </div>
                )}
                {editing && (
                  <Section title="Edit">
                    <EditField label="Name" v={draft.name} set={(v) => setDraft((d) => ({ ...d, name: v }))} />
                    <EditField label="Age" v={draft.age} set={(v) => setDraft((d) => ({ ...d, age: v }))} />
                    <EditField label="Appearance — baseline (face, eyes, hair, build; the engine can only append here, never rewrite)" v={draft.appearance_facts} set={(v) => setDraft((d) => ({ ...d, appearance_facts: v }))} rows={3} />
                    <button className="btn w-full -mt-1" disabled={blBusy}
                      onClick={async () => {
                        setBlBusy(true);
                        try { const { baseline } = await api.completeBaseline(save.id, sel!); setDraft((d) => ({ ...d, appearance_facts: baseline })); }
                        finally { setBlBusy(false); }
                      }}>
                      {blBusy ? "completing…" : "complete baseline gaps (hair, eyes, face — one cheap call; review before weaving in)"}
                    </button>
                    <EditField label="Presenting now (clothes, grime, visible state — freely rewritten in play)" v={draft.appearance_now} set={(v) => setDraft((d) => ({ ...d, appearance_now: v }))} rows={2} />
                    <div className="flex gap-2">
                      <EditField label="Height (ft)" v={draft.height_ft} set={(v) => setDraft((d) => ({ ...d, height_ft: v }))} rows={1} />
                      <EditField label="(in)" v={draft.height_in} set={(v) => setDraft((d) => ({ ...d, height_in: v }))} rows={1} />
                      <EditField label="Weight (lbs — scales hunger/thirst)" v={draft.weight_lb} set={(v) => setDraft((d) => ({ ...d, weight_lb: v }))} rows={1} />
                    </div>
                    <EditField label="Background — bedrock identity (never auto-trimmed)" v={draft.background} set={(v) => setDraft((d) => ({ ...d, background: v }))} rows={3} />
                    <EditField label="Story so far — what’s happened in play (auto-grows & compresses)" v={draft.life_history} set={(v) => setDraft((d) => ({ ...d, life_history: v }))} rows={3} />
                    <EditField label="Current goal" v={draft.current_goal} set={(v) => setDraft((d) => ({ ...d, current_goal: v }))} />
                    <EditField label="Core traits (one per line)" v={draft.core_traits} set={(v) => setDraft((d) => ({ ...d, core_traits: v }))} rows={4} />
                    <button className="btn btn-accent w-full mt-2" onClick={commitEdit}>Save changes</button>
                  </Section>
                )}
                <Section title="Now">
                  {(() => {
                    const cusp = ((save as any).undertow?.cusps ?? {})[sel!];
                    return cusp ? (
                      <div className="flex items-center gap-3 pb-2">
                        <CuspGlyph a={cusp.a} b={cusp.b} x={cusp.x} />
                        <div className="text-[11px] leading-relaxed flex-1" style={{ color: "var(--text-lo)" }}>
                          Composure homes to their natural set point. Only sustained battering opens the shaded wedge where snaps become possible — and calm closes it again.
                        </div>
                      </div>
                    ) : null;
                  })()}
                  <Row k="mood" v={`${nice(cond.psyche.mood)} (${opennessLabel(cond.psyche.relaxation)})`} />
                  {cond.psyche.active_states.length > 0 && <Row k="feeling" v={cond.psyche.active_states.map(nice).join(", ")} />}
                  <Row k="body" v={`${nice(cond.fatigue)} · ${nice(cond.hunger)}`} />
                  {cond.conditions.length > 0 && <Row k="afflicted" v={cond.conditions.map(nice).join(", ")} />}
                  {cond.injuries.length > 0 && <Row k="injuries" v={cond.injuries.map((x) => nice(x.type)).join("; ")} />}
                  {(c.texture ?? []).length > 0 && <Row k="texture" v={(c.texture ?? []).join(" · ")} />}
                  {c.drive && <Row k="wants" v={`${c.drive.goal} — ${c.drive.progress}%${c.drive.blocker ? ` (blocked: ${nice(c.drive.blocker)})` : ""}`} />}
                  {(c.drive_queue ?? []).length > 0 && <Row k="then" v={(c.drive_queue ?? []).map((d) => d.goal).join(" · ")} />}
                  {c.appearance_now?.trim() && <Row k="presenting" v={c.appearance_now} />}
                  {(cond.thirst_meter ?? 0) >= 6.5 && <Row k="thirst" v={(cond.thirst_meter ?? 0) >= 8 ? "parched" : "thirsty"} />}
                  {(cond.awake_minutes ?? 0) >= 17 * 60 && <Row k="sleep" v={`${Math.round((cond.awake_minutes ?? 0) / 60)}h awake`} />}
                  <Row k="where" v={save.world.places[c.location ?? ""]?.name ?? (c.location ? c.location : "—")} />
                  {sel !== "char_player" && <Row k="status" v={c.tracked ? "followed — lives on in the world, always wanting something" : "not followed — fades into the background when offscreen"} />}
                </Section>

                {(c.background || c.life_history) && (
                  <Section title="Identity">
                    <div className="font-mono text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--text-lo)" }}>Background (who they fundamentally are)</div>
                    {c.background && <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{c.background}</div>}
                    {c.life_history?.trim() && (
                      <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--ink-2)" }}>
                        <div className="font-mono text-[9px] uppercase tracking-widest mb-1" style={{ color: "var(--accent)" }}>Story so far (what's happened in play)</div>
                        <div className="text-[12.5px] leading-relaxed italic" style={{ color: "var(--text-mid)" }}>{c.life_history}</div>
                      </div>
                    )}
                  </Section>
                )}

                <Section title="Knows — verified facts (the Truth panel)">
                  <div className="text-[11px] italic mb-1.5" style={{ color: "var(--text-lo)" }}>
                    Durable facts this character holds — verbatim-checked at write time, never decayed, never paraphrased again. Corrections here are law: the engine treats this list as ground truth in every future turn.
                  </div>
                  {(mem?.facts ?? []).length === 0 && <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>Nothing ledgered yet — facts land here as the story establishes them, or add one by hand.</div>}
                  {(mem?.facts ?? []).map((f, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 py-1" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                      <div className="flex-1">
                        <div className="text-[12.5px] leading-snug">{f.content}</div>
                        {f.quote && <div className="text-[10.5px] italic mt-0.5" style={{ color: "var(--text-lo)" }}>“{f.quote}”</div>}
                        {sourceLabel((f as any).source) && <div className="text-[9.5px] mt-0.5 uppercase tracking-wide" style={{ color: "var(--text-lo)" }}>via {sourceLabel((f as any).source)}</div>}
                      </div>
                      <button disabled={factsBusy} onClick={() => commitFacts((mem?.facts ?? []).filter((_, j) => j !== i).map((x) => ({ content: x.content, quote: x.quote })))}>
                        <X size={13} style={{ color: "var(--text-lo)" }} />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input className="field flex-1" placeholder="e.g. Grew up in Seattle" value={newFact} onChange={(e) => setNewFact(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newFact.trim()) { commitFacts([...(mem?.facts ?? []).map((x) => ({ content: x.content, quote: x.quote })), { content: newFact.trim() }]); setNewFact(""); } }} />
                    <button className="btn" disabled={factsBusy || !newFact.trim()}
                      onClick={() => { commitFacts([...(mem?.facts ?? []).map((x) => ({ content: x.content, quote: x.quote })), { content: newFact.trim() }]); setNewFact(""); }}>
                      add
                    </button>
                  </div>
                </Section>

                {sel !== "char_player" && c.status !== "dead" && (
                  <Section title="Interview — a quiet aside (leaves no trace)">
                    <div className="text-[11px] italic mb-1.5" style={{ color: "var(--text-lo)" }}>
                      Talk to {c.name} out of scene. They answer only from what they actually know and feel; nothing here enters the story, their memory, or the world. One cheap call per question.
                    </div>
                    {ivLog.map((t, i) => (
                      <div key={i} className="py-1.5">
                        <div className="text-[12px]" style={{ color: "var(--text-lo)" }}>you: {t.q}</div>
                        <div className="text-[12.5px] leading-relaxed mt-0.5">{t.a}</div>
                      </div>
                    ))}
                    {ivErr && <div className="font-mono text-[10px]" style={{ color: "var(--danger)" }}>{ivErr}</div>}
                    <div className="flex gap-2 mt-1">
                      <input className="field flex-1" placeholder={`ask ${c.name.split(" ")[0]} something…`} value={ivQ} onChange={(e) => setIvQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") ask(); }} />
                      <button className="btn" disabled={ivBusy || !ivQ.trim()} onClick={ask}>{ivBusy ? "…" : "ask"}</button>
                    </div>
                  </Section>
                )}

                {(cond.inventory.length > 0 || cond.wearing.length > 0) && (
                  <Section title="Carrying & wearing">
                    {cond.wearing.length > 0 && <Row k="wearing" v={cond.wearing.map(nice).join(", ")} />}
                    {cond.inventory.length > 0 && <Row k="items" v={cond.inventory.map((i) => niceCap(i.name)).join(", ")} />}
                  </Section>
                )}

                {traits.length > 0 && (
                  <Section title="Acquired self">
                    {traits.map((t) => (
                      <div key={t.id} className="py-1.5">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[13.5px]">{niceCap(t.label)}</span>
                          <span className="font-mono text-[10px]" style={{ color: "var(--text-lo)" }}>×{t.reinforcement_count}</span>
                        </div>
                        <div className="meter mt-1.5"><div style={{ width: `${t.intensity * 10}%` }} /></div>
                      </div>
                    ))}
                  </Section>
                )}

                {playerEdges.length > 0 && (
                  <Section title="Bonds">
                    {playerEdges.map((e) => {
                      const other = save.characters[e.to]?.name ?? e.to;
                      return (
                        <div key={e.to} className="py-1.5">
                          <div className="flex justify-between text-[13.5px]">
                            <span>→ {other}{e.roles?.length ? <span style={{ color: "var(--accent)" }}> · {e.roles.join(" & ")}</span> : null}</span>
                            <span className="font-mono text-[10px]" style={{ color: e.warmth >= 0 ? "var(--calm)" : "var(--danger)" }}>
                              {e.warmth >= 0 ? "warm" : "cold"} {Math.abs(e.warmth)} · trust {e.trust}{e.attraction !== undefined ? ` · ${attractionWord(e.attraction)}` : ""}
                            </span>
                          </div>
                          {e.notes && <div className="text-[11.5px] italic mt-0.5" style={{ color: "var(--text-lo)" }}>{e.notes}</div>}
                        </div>
                      );
                    })}
                  </Section>
                )}

                {gmIntents.length > 0 && (
                  <Section title="GM · what they concealed">
                    <div className="text-[11px] mb-1.5" style={{ color: "var(--text-lo)" }}>
                      Private intent behind the prose — the truth the narration deliberately hid. Newest first. This is your verification that {c?.name ?? "they"} act from their own hidden state, not the surface.
                    </div>
                    {gmIntents.map((g) => (
                      <div key={g.turn} className="py-1.5 border-t" style={{ borderColor: "var(--hairline)" }}>
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span style={{ color: "var(--text-lo)" }}>turn {g.turn}</span>
                          {g.lying && <span className="font-mono text-[10px]" style={{ color: "var(--danger)" }}>LIED</span>}
                        </div>
                        {/* "showed" read as a transcript of what the character said. It isn't: intents are authored
                            BEFORE the narrator writes the scene, so this is the stance they brought to the beat,
                            not their spoken words. Labelling it as speech made the system look like it was
                            inventing dialogue that never appeared in the prose. */}
                        <div className="text-[12.5px]"><span style={{ color: "var(--text-lo)" }}>intended to show:</span> {g.surface}</div>
                        <div className="text-[12.5px] mt-0.5"><span style={{ color: "var(--accent)" }}>truth:</span> {g.truth}</div>
                      </div>
                    ))}
                  </Section>
                )}

                {mem && (
                  <Section title="Memory">
                    {(save.traits[sel!] ?? []).length > 0 && (
                      <div className="pb-1.5">
                        <div className="font-mono text-[9.5px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>becoming</div>
                        {(save.traits[sel!] ?? []).map((t, i) => (
                          <div key={`at${i}`} className="text-[12.5px] py-0.5 leading-relaxed">
                            <span style={{ color: "var(--accent)" }}>{t.label}</span>
                            <span className="font-mono text-[9px] ml-1.5" style={{ color: "var(--text-lo)" }}>i{(t.intensity ?? 0).toFixed(0)} · w{(t.self_weight ?? 0).toFixed(0)}</span>
                            <span style={{ color: "var(--text-mid)" }}> — {t.behavioral_impact}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {mem.beliefs.map((b, i) => (
                      <div key={`b${i}`} className="text-[13px] py-1" style={{ color: "var(--accent)" }}>※ {b.content}{typeof b.confidence === "number" ? <span className="font-mono text-[9px] ml-1" style={{ color: "var(--text-lo)" }}>{Math.round(b.confidence * 100)}%</span> : null}</div>
                    ))}
                    {[...mem.episodic].sort((a, b) => ((b.event_turn ?? b.turn) - (a.event_turn ?? a.turn))).slice(0, 7).map((m, i) => (
                      <div key={i} className="text-[12.5px] py-1 leading-relaxed" style={{ color: "var(--text-mid)" }}>
                        <span className="font-mono text-[9.5px] mr-1.5" style={{ color: "var(--text-lo)" }}>
                          {m.when_label ? m.when_label.replace(/\s*\(.*\)$/, "") : `t${m.turn}`}{m.anchor_rel ? ` · ${m.anchor_rel}` : ""}{m.where ? ` · ${m.where}` : ""}{sourceLabel((m as any).source) ? ` · ${sourceLabel((m as any).source)}` : ""}
                        </span>
                        {m.content}
                      </div>
                    ))}
                  </Section>
                )}

                <Section title="Core">
                  <div className="text-[13px] leading-relaxed" style={{ color: "var(--text-mid)" }}>{c.background}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2.5">
                    {c.core_traits.map((t) => <span key={t} className="chip">{nice(t)}</span>)}
                  </div>
                </Section>

                {(save.habits?.[sel!] ?? []).length > 0 && (
                  <Section title="How set their patterns are">
                    <div className="text-[11px] mb-2" style={{ color: "var(--text-lo)" }}>How automatic each core pattern is right now. Seen clearly as it fires, a pattern loosens; unseen, it deepens. No one changes on purpose.</div>
                    {(save.habits?.[sel!] ?? []).map((h) => (
                      <div key={h.trait} className="py-1.5" style={{ borderBottom: "1px solid var(--ink-2)" }}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[12.5px]" style={{ color: h.dormant ? "var(--text-lo)" : "var(--text-mid)", textDecoration: h.dormant ? "line-through" : "none" }}>{nice(h.trait)}</span>
                          <span className="text-[10px] font-mono" style={{ color: "var(--text-lo)" }}>{h.dormant ? "loosened" : `${Math.round(h.strength)}`}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: "var(--ink-2)", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, h.strength))}%`, background: h.dormant ? "var(--text-lo)" : h.strength > 70 ? "var(--text-mid)" : "var(--accent, #8a7a9e)", transition: "width .3s" }} />
                        </div>
                        {h.seen_fires > 0 && <div className="text-[9.5px] mt-0.5" style={{ color: "var(--text-lo)" }}>seen {h.seen_fires}×</div>}
                      </div>
                    ))}
                  </Section>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {rawJson !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 90, background: "var(--ink-0)", display: "flex", flexDirection: "column", paddingTop: "env(safe-area-inset-top)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
            <div className="font-display text-[16px]">Raw edit</div>
            <div className="text-[12px] mt-1" style={{ color: "var(--text-mid)" }}>
              Full character record — identity, condition, acquired traits, memory. Edit the JSON and save. Add traits to the "traits" array, beliefs under "memory".
            </div>
            {rawErr && <div className="text-[12px] mt-1.5 px-2 py-1 rounded" style={{ color: "var(--danger)", background: "var(--danger-soft, rgba(200,60,60,.12))" }}>{rawErr}</div>}
            <div className="flex gap-2 mt-2.5">
              <button className="btn btn-accent" style={{ flex: 1 }} onClick={async () => {
                try {
                  const parsed = JSON.parse(rawJson);
                  setSave(await api.rawEditCharacter(save.id, sel!, parsed));
                  setRawJson(null); setRawErr("");
                } catch (e: any) { setRawErr(e?.message?.includes("JSON") ? "Invalid JSON — check your brackets and commas." : (e?.message ?? "save failed")); }
              }}>Save changes</button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setRawJson(null); setRawErr(""); }}>Cancel</button>
            </div>
          </div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false} autoCapitalize="off" autoCorrect="off"
            style={{ flex: 1, width: "100%", background: "var(--ink-1)", color: "var(--text-mid)", border: "none", padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
        </div>
      )}

    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--text-lo)" }}>{title}</div>
      {children}
    </div>
  );
}
function EditField({ label, v, set, rows }: { label: string; v: string; set: (v: string) => void; rows?: number }) {
  return (
    <div className="py-1.5">
      <div className="font-mono text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-lo)" }}>{label}</div>
      {rows ? (
        <textarea className="field" rows={rows} value={v} onChange={(e) => set(e.target.value)} />
      ) : (
        <input className="field" value={v} onChange={(e) => set(e.target.value)} />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3 py-1 text-[13.5px]">
      <span className="font-mono text-[10.5px] uppercase pt-0.5 w-16 shrink-0" style={{ color: "var(--text-lo)" }}>{k}</span>
      <span style={{ color: "var(--text-hi)" }}>{v}</span>
    </div>
  );
}
