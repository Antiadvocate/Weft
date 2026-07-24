
/**
 * STORY MAP — the world as the player has actually walked it.
 * Nodes are visited places (from the travel log the bookkeeper writes), edges are moves.
 * Layout is a tiny hand-rolled force relax over seeded initial positions — deterministic
 * per set of places, so the map doesn't reshuffle between opens. The newest edge draws
 * itself in; "you are here" breathes.
 */
import React, { useMemo } from "react";
import type { ClientSave } from "./api";
import { hashSeed, mulberry32 } from "./tone";

const W = 320, H = 230, PAD = 26;

interface Node { id: string; name: string; x: number; y: number }

function layout(ids: string[], edges: [string, string][]): Map<string, Node> {
  const rnd = mulberry32(hashSeed(ids.slice().sort().join("|")));
  const nodes = new Map<string, Node>();
  ids.forEach((id, i) => {
    const ang = (i / Math.max(1, ids.length)) * Math.PI * 2 + rnd() * 0.8;
    nodes.set(id, { id, name: "", x: W / 2 + Math.cos(ang) * (60 + rnd() * 50), y: H / 2 + Math.sin(ang) * (45 + rnd() * 38) });
  });
  const linked = new Set(edges.map(([a, b]) => `${a}|${b}`));
  const isEdge = (a: string, b: string) => linked.has(`${a}|${b}`) || linked.has(`${b}|${a}`);
  for (let it = 0; it < 140; it++) {
    const arr = [...nodes.values()];
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy) || 0.01; dx /= d; dy /= d;
      // universal repulsion + spring toward rest length on linked pairs
      const rep = 900 / (d * d);
      let f = -rep;
      if (isEdge(a.id, b.id)) f += (d - 74) * 0.045;
      a.x += dx * f; a.y += dy * f; b.x -= dx * f; b.y -= dy * f;
    }
    for (const n of arr) { // soft bounds
      n.x = Math.max(PAD, Math.min(W - PAD, n.x));
      n.y = Math.max(PAD, Math.min(H - PAD, n.y));
    }
  }
  return nodes;
}

export default function StoryMap({ save }: { save: ClientSave }) {
  const log = (save as any).travel_log as { turn: number; place: string }[] | undefined ?? [];
  const here = save.world.player_location;

  const { nodes, edges, newest } = useMemo(() => {
    const ids = [...new Set(log.map((t) => t.place))].filter((id) => save.world.places[id]);
    if (here && save.world.places[here] && !ids.includes(here)) ids.push(here);
    const edgeSet = new Map<string, [string, string]>();
    for (let i = 1; i < log.length; i++) {
      const a = log[i - 1].place, b = log[i].place;
      if (a === b || !save.world.places[a] || !save.world.places[b]) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edgeSet.set(k, [a, b]);
    }
    const edges = [...edgeSet.values()];
    const nodes = layout(ids, edges);
    for (const n of nodes.values()) n.name = save.world.places[n.id]?.name ?? n.id;
    const newest = log.length >= 2 ? ([log[log.length - 2].place, log[log.length - 1].place] as [string, string]) : null;
    return { nodes, edges, newest };
  }, [log.length, here, save.world.current_turn, Object.keys(save.world.places).length]);

  if (!nodes.size) return <div className="text-[12.5px] italic py-1" style={{ color: "var(--text-lo)" }}>Nowhere yet. Walk somewhere.</div>;

  const isNewest = (a: string, b: string) => !!newest && ((newest[0] === a && newest[1] === b) || (newest[0] === b && newest[1] === a));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="map of visited places">
      {edges.map(([a, b]) => {
        const na = nodes.get(a), nb = nodes.get(b);
        if (!na || !nb) return null;
        const fresh = isNewest(a, b);
        return (
          <line key={`${a}|${b}${fresh ? `-${log.length}` : ""}`}
            x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
            pathLength={1}
            className={fresh ? "map-edge-new" : undefined}
            stroke={fresh ? "var(--accent)" : "var(--line-strong)"} strokeWidth={1} />
        );
      })}
      {[...nodes.values()].map((n) => {
        const you = n.id === here;
        return (
          <g key={n.id}>
            {you && <circle className="map-you" cx={n.x} cy={n.y} r={6} fill="none" stroke="var(--accent)" strokeWidth={1} />}
            <circle cx={n.x} cy={n.y} r={you ? 4.5 : 3} fill={you ? "var(--accent)" : "var(--ink-3)"} stroke={you ? "none" : "var(--line-strong)"} strokeWidth={0.75} />
            <text x={n.x} y={n.y - 8} textAnchor="middle"
              style={{ font: "8.5px var(--font-mono)", fill: you ? "var(--accent)" : "var(--text-lo)", letterSpacing: ".04em" }}>
              {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

