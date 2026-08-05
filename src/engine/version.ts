/**
 * SAVE PROVENANCE — which build wrote this file.
 *
 * Exports carried no build identity at all, so a save landing in a bug report was undatable: you
 * could not tell whether a symptom was a live bug or one already fixed two builds ago, and the
 * only way to guess was to read the shape of the data and infer. Every export now stamps what
 * produced it.
 *
 * SCHEMA_VERSION is the one that matters for behavior — bump it when the SHAPE of a save changes
 * (a new field the engine relies on, a migration, a semantic change to an existing field), not for
 * ordinary fixes. BUILD is free-form provenance for humans reading a bug report.
 */

/** Bump when the save's shape or semantics change. */
export const SCHEMA_VERSION = 4;

/** Human-readable build identity, stamped into every export. */
export const APP_VERSION = "1.0.0";

/** What changed at each schema version — so a stamped save can be read back years later. */
export const SCHEMA_HISTORY: Record<number, string> = {
  1: "original",
  2: "edges carry attraction/attraction_base; desire is its own axis",
  3: "power_witnessed on the save; offstage_last_turn on the world",
  4: "edges carry authored_seed; exports are stamped with provenance",
};

export interface SaveStamp {
  schema: number;       // SCHEMA_VERSION at export time
  app: string;          // APP_VERSION
  exported_at: string;  // ISO timestamp
  turn: number;         // where the story stood
  engine?: string;      // optional build/commit id when one is available
}

/** Build the stamp for an export. */
export function stampFor(turn: number, engine?: string): SaveStamp {
  return {
    schema: SCHEMA_VERSION,
    app: APP_VERSION,
    exported_at: new Date().toISOString(),
    turn,
    ...(engine ? { engine } : {}),
  };
}

/** Describe an imported save's provenance in one line, for the import path and bug reports. */
export function describeStamp(stamp: SaveStamp | undefined): string {
  if (!stamp) return "unstamped save — exported before provenance existed (schema 3 or earlier)";
  const age = stamp.schema < SCHEMA_VERSION ? ` (this build is schema ${SCHEMA_VERSION})` : "";
  return `Weft ${stamp.app}, schema ${stamp.schema}${age}, exported ${stamp.exported_at.slice(0, 10)} at turn ${stamp.turn}`;
}
