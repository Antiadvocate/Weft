/** IndexedDB save store. Plain JSON values; comfortably holds image data URLs. */
import type { SaveState } from "./engine/types";
import { sanitize } from "./engine/state";

const DB = "weft";
const STORE = "saves";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then((db) => new Promise<T>((res, rej) => {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    const r = fn(store);
    r.onsuccess = () => res(r.result as T);
    r.onerror = () => rej(r.error);
  }));
}

/**
 * WRITE A SAVE — and do not serialise the whole world twice to do it.
 *
 * This was `store.put(JSON.parse(JSON.stringify(s)))`, which is two full passes over the entire
 * save — every memory, every fact ledger, every base64 portrait and scene illustration, plus the
 * seven snapshot blobs — producing one enormous intermediate string and one complete second copy,
 * and then handing the result to IndexedDB, which structured-clones it AGAIN internally. Three
 * copies of a save that can reach tens of megabytes on a long illustrated campaign.
 *
 * And it runs on EVERY api call, not once a turn: a single turn writes the save many times over.
 * On a big save that is seconds of blocked main thread and hundreds of megabytes of garbage per
 * turn, which is what "it locks up, and then it shuts down" looks like from the outside — the tab
 * stops painting, and on a phone the OS eventually takes the process.
 *
 * The round trip was doing one real job: dropping values structured clone refuses (`undertow` is
 * typed `unknown` and has held class instances). So try the direct write first — IndexedDB does
 * its own clone, correctly, without a string in the middle — and pay for the JSON scrub only on
 * the DataCloneError that says it was needed.
 */
export async function putSave(s: SaveState): Promise<void> {
  s.updated_at = new Date().toISOString();
  try {
    await tx("readwrite", (store) => store.put(s));
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== "DataCloneError") throw err;
    console.warn("[store] save held a value structured clone refused — falling back to a JSON scrub");
    await tx("readwrite", (store) => store.put(JSON.parse(JSON.stringify(s))));
  }
}

export async function getSave(id: string): Promise<SaveState | null> {
  const raw = await tx<SaveState | undefined>("readonly", (store) => store.get(id));
  return raw ? sanitize(raw) : null;
}

export async function deleteSave(id: string): Promise<void> {
  await tx("readwrite", (store) => store.delete(id));
  // side rows (recovery/backup) carry full state copies incl. image data — deleting the save
  // used to orphan them in IndexedDB forever
  await tx("readwrite", (store) => store.delete(`${id}::recovery`)).catch(() => {});
  await tx("readwrite", (store) => store.delete(`${id}::backup`)).catch(() => {});
}

export async function listSaves(): Promise<{ id: string; name: string; updated_at: string; turn: number; world_name: string }[]> {
  const all = await tx<SaveState[]>("readonly", (store) => store.getAll());
  return (all ?? [])
    .filter((s) => !s.id.includes("::"))  // recovery/backup rows are internal
    .map((s) => ({ id: s.id, name: s.name, updated_at: s.updated_at, turn: s.world.current_turn, world_name: s.world_bible.name }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** ── SAFETY RAILS ─────────────────────────────────────────────────────────────
 * Side rows in the same store, keyed `${id}::recovery` and `${id}::backup`.
 * recovery = the FULL pre-rollback state (snapshots included), written the moment
 * a rollback executes — one level of undo for the "oh fuck" moment.
 * backup   = a rolling checkpoint written every 25 turns, so catastrophic loss is
 * bounded even when no export exists. Neither appears in save lists. */
export async function putSideRow(id: string, kind: "recovery" | "backup", s: SaveState): Promise<void> {
  const clone = JSON.parse(JSON.stringify(s)) as SaveState;
  clone.id = `${id}::${kind}`;
  await tx("readwrite", (store) => store.put(clone));
}
export async function getSideRow(id: string, kind: "recovery" | "backup"): Promise<SaveState | null> {
  const raw = await tx<SaveState | undefined>("readonly", (store) => store.get(`${id}::${kind}`));
  if (!raw) return null;
  const s = sanitize(raw);
  s.id = id; // restore under the original identity
  return s;
}
export async function deleteSideRow(id: string, kind: "recovery" | "backup"): Promise<void> {
  await tx("readwrite", (store) => store.delete(`${id}::${kind}`));
}
