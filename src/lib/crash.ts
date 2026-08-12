/**
 * CRASH RECORD — because "it locks up and shuts down and I never see an error" is not a bug report
 * anyone can act on, and that is the app's fault rather than the player's.
 *
 * There was an error boundary. It caught RENDER errors, printed `String(err)` with no stack, and
 * offered a reload. Three things wrong with that, and each maps onto a symptom:
 *
 *   · IT CANNOT SEE MOST OF WHAT GOES WRONG HERE. A turn is one long async pipeline — two model
 *     calls, a dozen deterministic passes, several IndexedDB writes. A rejected promise anywhere in
 *     it never touches React's render path, so the boundary never fires: the composer's `running`
 *     flag just stays true and the app sits there, forever, with the button greyed out. That is
 *     "it locks up", exactly, and there is nothing on screen because nothing on screen was told.
 *   · A MESSAGE WITH NO STACK AND NO CONTEXT IS NOT DIAGNOSTIC. On a phone there is no console to
 *     open. "undefined is not an object" is the whole report the player can give.
 *   · A TAB THAT IS KILLED RENDERS NOTHING AT ALL. If the browser runs out of memory on a large
 *     save, the process dies — there is no exception, no handler, no chance to draw. Anything the
 *     player is going to learn about that has to have been written down BEFORE it happened.
 *
 * So: a breadcrumb, updated as the app works, held in localStorage (which survives the process);
 * global handlers for the two error channels the boundary cannot reach; and a dirty-shutdown flag
 * that turns "the tab vanished" into a sentence on the next boot. None of it prevents a crash. It
 * turns an invisible one into a report that says what the app was doing and how big the save was
 * when it stopped, which is the difference between guessing and fixing.
 */

const CRASH_KEY = "weft:crashes";
const CRUMB_KEY = "weft:breadcrumb";
const ALIVE_KEY = "weft:alive";
const MAX_KEPT = 5;

export interface Breadcrumb {
  ts: number;
  save_id?: string;
  save_name?: string;
  turn?: number;
  /** What the app was in the middle of — the turn loop's own phase labels. */
  phase?: string;
  /** Roughly how many bytes the save serialises to. The single most useful number for a crash
   *  nobody witnessed: a browser tab dies at a size, and knowing whether this one was 3 MB or
   *  300 MB decides whether the answer is a bug hunt or a prune. */
  save_bytes?: number;
  /** How many scene illustrations the save is carrying, since that is what makes it large. */
  images?: number;
}

export interface CrashRecord {
  when: string;
  kind: "render" | "rejection" | "error" | "abrupt";
  message: string;
  stack?: string;
  crumb?: Breadcrumb;
}

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
}
function write(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode, or full — not worth crashing over */ }
}

/** What the app is doing right now. Merged, so a caller can update one field. Cheap enough to call
 *  on every phase change; deliberately NOT called per token. */
export function leaveBreadcrumb(patch: Partial<Breadcrumb>): void {
  const cur = read<Breadcrumb>(CRUMB_KEY, { ts: Date.now() });
  write(CRUMB_KEY, { ...cur, ...patch, ts: Date.now() });
}
export function lastBreadcrumb(): Breadcrumb | null {
  const c = read<Breadcrumb | null>(CRUMB_KEY, null);
  return c && typeof c.ts === "number" ? c : null;
}

export function recordCrash(kind: CrashRecord["kind"], err: unknown, extra?: Partial<Breadcrumb>): CrashRecord {
  const e = err as { message?: string; stack?: string; name?: string } | undefined;
  const rec: CrashRecord = {
    when: new Date().toISOString(),
    kind,
    message: String(e?.message ?? err ?? "unknown").slice(0, 400),
    stack: typeof e?.stack === "string" ? e.stack.slice(0, 4000) : undefined,
    crumb: { ...(lastBreadcrumb() ?? { ts: Date.now() }), ...extra },
  };
  const all = [...read<CrashRecord[]>(CRASH_KEY, []), rec].slice(-MAX_KEPT);
  write(CRASH_KEY, all);
  console.error(`[weft] ${kind}:`, err);
  return rec;
}

export function takeCrashes(): CrashRecord[] {
  return read<CrashRecord[]>(CRASH_KEY, []);
}
export function clearCrashes(): void {
  try { localStorage.removeItem(CRASH_KEY); } catch { /* nothing to clear */ }
}

/**
 * THE ONE THAT CATCHES A KILLED TAB.
 *
 * `alive` is set on boot and cleared on the way out. If it is still set the next time the app
 * starts, the previous session did not leave — it was ended, by an out-of-memory kill, a crashed
 * renderer, or a force-quit. Nothing else in the app can observe that: by the time it happens
 * there is no JavaScript left to run.
 *
 * `pagehide` rather than `beforeunload`/`unload`, which mobile Safari does not fire reliably.
 */
export function markAlive(): void {
  write(ALIVE_KEY, { at: Date.now() });
  const clear = () => { try { localStorage.removeItem(ALIVE_KEY); } catch { /* going away anyway */ } };
  window.addEventListener("pagehide", clear);
  window.addEventListener("freeze", clear);
}

/** Did the last session die without saying goodbye? Consumed once, so it reports on the boot after
 *  the crash and not on every boot thereafter. */
export function takeAbruptExit(): Breadcrumb | null {
  const alive = read<{ at: number } | null>(ALIVE_KEY, null);
  if (!alive) return null;
  try { localStorage.removeItem(ALIVE_KEY); } catch { /* best effort */ }
  const crumb = lastBreadcrumb();
  recordCrash("abrupt", new Error("the previous session ended without shutting down — the tab was closed, reloaded, or killed"), crumb ?? undefined);
  return crumb;
}

/**
 * The two channels a React error boundary cannot see. Installed once, at boot.
 *
 * These deliberately do NOT swallow anything or try to recover: the app's own handlers still run,
 * the console still gets it. All this does is make sure the failure is written down somewhere the
 * player can reach, with what the app was doing attached.
 */
export function installCrashHandlers(onCrash?: (rec: CrashRecord) => void): void {
  window.addEventListener("unhandledrejection", (ev) => {
    // An aborted turn is a rejection by design — the player pressed stop. Not a crash.
    const reason = (ev as PromiseRejectionEvent).reason as { name?: string; message?: string } | undefined;
    if (reason?.name === "AbortError" || /aborted|cancell?ed/i.test(String(reason?.message ?? ""))) return;
    onCrash?.(recordCrash("rejection", reason));
  });
  window.addEventListener("error", (ev) => {
    const e = ev as ErrorEvent;
    // Resource load failures (an <img> that 404s) surface here too and are not app crashes.
    if (!e.message && !e.error) return;
    onCrash?.(recordCrash("error", e.error ?? new Error(e.message)));
  });
}

/** One pasteable block. The point of the copy button: a player can hand this over without being
 *  asked to open a console they cannot open. */
export function formatCrash(rec: CrashRecord): string {
  const c = rec.crumb;
  return [
    `WEFT CRASH REPORT`,
    `when:    ${rec.when}`,
    `kind:    ${rec.kind}`,
    `message: ${rec.message}`,
    c ? `doing:   turn ${c.turn ?? "?"}${c.phase ? ` · ${c.phase}` : ""}${c.save_name ? ` · save "${c.save_name}"` : ""}` : "",
    c?.save_bytes ? `save:    ${(c.save_bytes / 1048576).toFixed(1)} MB${c.images ? `, ${c.images} scene images` : ""}` : "",
    `agent:   ${navigator.userAgent}`,
    rec.stack ? `\n${rec.stack}` : "",
  ].filter(Boolean).join("\n");
}

/**
 * ROUGHLY HOW HEAVY THIS SAVE IS, without serialising it.
 *
 * `JSON.stringify(save).length` would be the exact answer and is the very thing that makes a large
 * save painful — measuring the problem by doing the expensive thing once per turn is not a
 * measurement, it is a second copy of the bug. Base64 image payloads dominate a big save by orders
 * of magnitude, so summing their lengths plus the prose gets within a few percent for free.
 */
export function estimateSaveWeight(save: {
  characters?: Record<string, { portrait_url?: string } | undefined>;
  history?: { illustration_url?: string; narrator_prose?: string }[];
}): { bytes: number; images: number } {
  let bytes = 0, images = 0;
  for (const c of Object.values(save.characters ?? {})) {
    if (c?.portrait_url) { bytes += c.portrait_url.length; images++; }
  }
  for (const h of save.history ?? []) {
    if (h.illustration_url) { bytes += h.illustration_url.length; images++; }
    bytes += h.narrator_prose?.length ?? 0;
  }
  return { bytes, images };
}
