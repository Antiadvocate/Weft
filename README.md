# Weft — a world that reacts (GitHub Pages build)

A persistent, social world-simulation engine with an LLM narrator. **This build runs entirely in your browser** — no server, no backend. The engine, the saves, and everything else live on your device; it talks to language models through *your own* OpenRouter key.

## Deploy it to your repo (the easy way)

1. Create a new GitHub repository and upload these files (or push this folder to it).
2. In the repo, go to **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds and publishes automatically.
4. Open the URL Pages gives you (e.g. `https://yourname.github.io/weft/`). Paste your OpenRouter key when prompted. Play.

That's it. Every push rebuilds and redeploys.

### Run it locally first (optional)

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # produces dist/ — the exact static bundle Pages serves
npm run preview  # serve the built dist/ locally
```

## The OpenRouter key

Weft has no server to hold a secret, so it uses **your** key, entered once and stored in your browser's `localStorage` on that device only. It is sent directly to OpenRouter and to nowhere else. Get one (free and paid models available) at <https://openrouter.ai/keys>. You can change it anytime in **Tuning**.

Because the key lives in the browser, **don't** hard-code it into the source or commit it. Anyone who can use your deployed page uses their own key.

> Note: calls go from your browser straight to `openrouter.ai`, which permits cross-origin requests. If your network or an extension blocks third-party requests, the model calls won't go through.

## Where your data lives

Saves (including any AI-generated portraits and scene art) are stored in your browser via **IndexedDB**. They persist across reloads but are tied to that browser/profile. Use **Tuning → Export save** to download a `.weft.json` you can back up or move; **Library → Import** to load one anywhere.

## What's inside

The full engine ported to the browser:

- **Two-call turn loop** — a streamed narrator and a single strict-JSON simulator; everything else is deterministic and free.
- **The Undertow** — the continuous substrate: logit Quantal Response Equilibrium stances, a frustrated Kuramoto network with a Benettin Lyapunov estimate of the world's regime, cusp-catastrophe psyches that home to each person's set point, and Scheffer early-warning signals.
- **Continuity** — let the world turn (deterministic multi-day skips with an interlude), and vessels (leave your character, become another, full identity swap).
- **Canon** — world-altering public events every mind remembers forever.
- **Park-style memory** with reflection, a social fabric of edges + rumor cascades, faction clocks, deterministic pressure control, the full world-bible & character editors, God Mode, dark/light, image generation, and the Chronicle's arcs, records, and regime read-outs.

Built with React 19 + Vite + Tailwind 4 + Motion. `base: "./"` means it works from a user root *or* a project subpath with no per-repo configuration.
