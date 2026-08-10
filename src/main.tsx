import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="p-6">
          <div className="font-display text-lg mb-2">Something went wrong.</div>
          <pre className="font-mono text-xs whitespace-pre-wrap" style={{ color: "var(--danger)" }}>
            {String(this.state.err)}
          </pre>
          <button className="btn mt-4" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary><App /></Boundary>
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
