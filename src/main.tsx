import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { clearCrashes, formatCrash, installCrashHandlers, markAlive, recordCrash, takeAbruptExit, takeCrashes, type CrashRecord } from "./lib/crash";

/**
 * The panel a crash actually lands on. See lib/crash.ts for why the old one — which caught render
 * errors only, printed `String(err)` with no stack, and offered a reload — could not report the
 * failures this app actually has.
 *
 * Two things it must do that the old one did not. It has to show enough to be pasted to somebody
 * (stack, what the app was doing, how big the save was), and it must not stand between the player
 * and a save that is still fine — most of what reaches here is one broken view, not a broken world,
 * and "Reload" on a save that crashes deterministically is a loop.
 */
function CrashPanel({ recs, onDismiss }: { recs: CrashRecord[]; onDismiss?: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const text = recs.map(formatCrash).join("\n\n———\n\n");
  return (
    <div className="p-5" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div className="font-display text-lg mb-1">Something broke.</div>
      <div className="text-[13px] mb-3" style={{ color: "var(--text-mid)" }}>
        Your save is on this device and is almost certainly fine — this is the app failing, not the
        world. Copy the report below if you want it fixed.
      </div>
      <pre className="font-mono text-[10.5px] whitespace-pre-wrap p-3"
        style={{ color: "var(--text-mid)", background: "var(--ink-1)", border: "1px solid var(--line)", borderRadius: 12, maxHeight: "45dvh", overflow: "auto" }}>
        {text}
      </pre>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className="btn" onClick={() => {
          navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false));
        }}>{copied ? "copied" : "copy report"}</button>
        {onDismiss && <button className="btn" onClick={onDismiss}>carry on</button>}
        <button className="btn" onClick={() => { clearCrashes(); location.reload(); }}>clear & reload</button>
      </div>
    </div>
  );
}

class Boundary extends React.Component<{ children: React.ReactNode }, { rec: CrashRecord | null }> {
  state = { rec: null as CrashRecord | null };
  static getDerivedStateFromError(err: Error) {
    return { rec: recordCrash("render", err) };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // The component stack is the half that says WHERE, and getDerivedStateFromError never sees it.
    recordCrash("render", { message: err.message, stack: `${err.stack ?? ""}\n--- component stack ---${info.componentStack ?? ""}` });
  }
  render() {
    if (this.state.rec) return <CrashPanel recs={takeCrashes().slice(-3)} />;
    return this.props.children;
  }
}

/** Async failures and a killed tab both land here — neither can reach the boundary above. A banner
 *  rather than a takeover: the app is still running, and hiding a working save behind a full-page
 *  error because one background write failed is its own bug. */
function Shell() {
  const [recs, setRecs] = React.useState<CrashRecord[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    markAlive();
    // A session that never said goodbye: an out-of-memory kill, a crashed renderer, a force-quit.
    // This is the only trace such an ending leaves, and it is written on the boot AFTER it happened.
    const abrupt = takeAbruptExit();
    if (abrupt) setRecs(takeCrashes().slice(-1));
    installCrashHandlers((rec) => setRecs((r) => [...r, rec].slice(-3)));
  }, []);
  return (
    <>
      {recs.length > 0 && !open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed z-[60] left-3 right-3 bottom-3 px-3 py-2 text-left font-mono text-[11px]"
          style={{ background: "var(--ink-2)", border: "1px solid var(--danger)", borderRadius: 12, color: "var(--danger)" }}>
          {recs[recs.length - 1].kind === "abrupt"
            ? `the last session ended abruptly${recs[recs.length - 1].crumb?.turn ? ` during turn ${recs[recs.length - 1].crumb!.turn}` : ""} — tap for the report`
            : `something failed in the background — tap for the report`}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-[70] overflow-auto" style={{ background: "var(--ink-0)" }}>
          <CrashPanel recs={recs} onDismiss={() => { setOpen(false); setRecs([]); }} />
        </div>
      )}
      <App />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary><Shell /></Boundary>
  </React.StrictMode>
);

// SERVICE WORKER — registered for one reason: a push notification cannot be delivered without one,
// and "your turn is ready" on the phone is the whole point of running turns on a relay. It caches
// nothing (see public/sw.js). Registration is best-effort and silent: no service worker means no
// notifications, and everything else about the app works exactly as before.
// Relative URL, because the build uses base "./" and may be served from a project subpath.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" })
      .catch(() => { /* file://, an insecure origin, or a browser that will not — play on regardless */ });
  });
}
