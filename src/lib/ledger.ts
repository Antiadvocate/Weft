
// ledger — derive the measurable deltas of the latest turn by comparing the
// last two telemetry frames. Nothing here calls a model; every number is
// already in the save. The ledger card renders these, then collapses when the
// next turn starts streaming.
import type { ClientSave } from "./api";
import { minutesBetween } from "../engine/time";

export interface LedgerRow {
  key: string;
  text: string;
  from?: number;
  to?: number;
  good?: boolean;
  icon: "clock" | "pressure" | "edge" | "person";
}

export function turnDeltas(save: ClientSave): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const tel = save.telemetry ?? [];
  const t1 = tel[tel.length - 1];
  const t0 = tel[tel.length - 2];

  // time passed — read straight off the two most recent frames' labels
  if (t0 && t1) {
    const mins = Math.max(0, minutesBetween(t0.time_label, t1.time_label));
    if (mins >= 30) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      rows.push({
        key: "time",
        icon: "clock",
        from: 0,
        to: mins,
        text: h ? `${h}h${m ? ` ${m}m` : ""} passed` : `${mins}m passed`,
      });
    }
  }

  if (t0 && t1) {
    if (t1.pressure !== t0.pressure)
      rows.push({
        key: "p",
        icon: "pressure",
        text: "pressure",
        from: t0.pressure,
        to: t1.pressure,
        good: t1.pressure < t0.pressure, // lower pressure reads as relief
      });

    for (const e of t1.edge_snapshot ?? []) {
      const prev = (t0.edge_snapshot ?? []).find((x) => x.pair === e.pair);
      if (!prev) continue;
      if (Math.abs(e.warmth - prev.warmth) >= 2)
        rows.push({
          key: e.pair + "w",
          icon: "edge",
          text: `${e.pair} · warmth`,
          from: prev.warmth,
          to: e.warmth,
          good: e.warmth > prev.warmth,
        });
      if (Math.abs(e.trust - prev.trust) >= 2)
        rows.push({
          key: e.pair + "t",
          icon: "edge",
          text: `${e.pair} · trust`,
          from: prev.trust,
          to: e.trust,
          good: e.trust > prev.trust,
        });
    }

    const p1 = new Set(save.world.present);
    const p0 = new Set(t0.present ?? []);
    for (const id of p1)
      if (!p0.has(id) && id !== "char_player")
        rows.push({
          key: "in" + id,
          icon: "person",
          text: `${save.characters[id]?.name ?? "someone"} arrived`,
        });
    for (const id of p0)
      if (!p1.has(id) && id !== "char_player")
        rows.push({
          key: "out" + id,
          icon: "person",
          text: `${save.characters[id]?.name ?? "someone"} left`,
        });
  }

  return rows.slice(0, 6);
}

