/**
 * IS THIS TAB RUNNING THE CURRENT BUILD?
 *
 * Weft is a single-page app served from static hosting. A tab left open keeps running whatever
 * bundle it loaded, forever — a deploy changes the files on the server and nothing on the client.
 * So a player can hit a bug, have it fixed and shipped, and go on hitting it for another hour,
 * with no way to tell that the code in front of them is an hour old. That has now happened twice
 * with the same bug, and the second time the save's own stamp said schema 4 while the running code
 * predated the fix — the stamp records the save format, not the bundle.
 *
 * Vite emits content-hashed asset filenames, so index.html is the version marker: fetch it past the
 * cache, read the main entry hash, compare with the one this page actually loaded. Different hash
 * means a newer build is sitting on the server.
 *
 * Deliberately cheap and non-blocking: one small conditional GET on an interval and on tab focus,
 * silent on every failure. Being offline is not being stale.
 */

const ENTRY = /assets\/(index-[A-Za-z0-9_-]+\.js)/;

/** The entry bundle this page is actually running, read from its own script tags. */
function runningEntry(): string | null {
  if (typeof document === "undefined") return null;
  for (const el of Array.from(document.querySelectorAll("script[src]"))) {
    const m = ENTRY.exec((el as HTMLScriptElement).src);
    if (m) return m[1];
  }
  return null;
}

/** The entry bundle the server is serving right now, or null when it can't be determined. */
async function servedEntry(): Promise<string | null> {
  try {
    const res = await fetch(`./index.html?_=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const m = ENTRY.exec(await res.text());
    return m ? m[1] : null;
  } catch {
    return null;   // offline, blocked, or served from somewhere without an index — never "stale"
  }
}

/** True when the server has a different build than the one this tab is running. */
export async function isStale(): Promise<boolean> {
  const mine = runningEntry();
  if (!mine) return false;            // dev server, or an unrecognisable page — say nothing
  const theirs = await servedEntry();
  return !!theirs && theirs !== mine;
}

/**
 * Watch for a newer build. Calls `onStale` once, then stops. Checks on an interval and whenever the
 * tab regains focus — the moment a player comes back to a tab they left open is exactly when it is
 * most likely to be out of date. Returns a cleanup function.
 */
export function watchForUpdate(onStale: () => void, everyMs = 5 * 60_000): () => void {
  if (typeof window === "undefined") return () => {};
  let done = false;
  const check = async () => {
    if (done || document.hidden) return;
    if (await isStale()) { done = true; stop(); onStale(); }
  };
  const timer = window.setInterval(check, everyMs);
  const onFocus = () => void check();
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  const stop = () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
  void check();
  return stop;
}
