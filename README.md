# VibeOs

An AI operating system: a macOS-style desktop in the browser where **every app is
HTML generated on the fly** by your local Claude Code. Windows are sandboxed
iframes you can drag, resize, minimize and close. There is no Notepad code, no
Calculator code — when you launch an app, the agent *hallucinates* its UI (and its
content) on demand, then keeps it interactive.

> Inspired by the idea of an OS that hallucinates pseudo-software on demand.

## Highlights

- **Apps are generated, not coded.** Launch anything from the dock, or press **⌘K**
  (Spotlight) and type any app you can imagine — *"finder but connected to a
  pentagon server"*, *"terminal, but passive-aggressive"* — and it gets generated.
- **Streaming UI.** The interface renders progressively as the model types it out,
  instead of waiting behind a spinner.
- **Hybrid interactivity.** Generated apps ship their own sandboxed JavaScript for
  instant local logic (calculators compute, terminals run a command loop, toggles
  and games just work). Anything that reveals *new* content — opening a folder, a
  file, a web page or link — round-trips to the agent, which generates that screen.
- **Shared virtual filesystem.** Apps read and write one filesystem, so a file
  saved in Notes shows up in Finder. Apps share real state.
- **Real windows.** Drag, resize (8 handles), focus/z-order, minimize-to-dock,
  maximize, **edge snapping** (halves/quarters), open/close/genie animations, and
  in-place DOM updates that preserve focus, caret and scroll.
- **App & page cache + Launchpad.** Generated apps and visited pages are cached
  (instant relaunch/revisit) and grow into a Launchpad grid; Spotlight
  autocompletes from the cache. The desktop session is restored on reload.
- **Local Claude Code as the engine.** Uses `@anthropic-ai/claude-agent-sdk` with
  your existing Claude Code login — no API key required. The agent runs isolated
  (no tools, no user MCP/settings) and only generates UI. A fast model is used for
  small in-place updates, a stronger one for full renders.

## Architecture

```
Browser ── shell (Vanilla TS + Vite) ──────────────┐
  window manager · dock · menu bar · Spotlight      │  WebSocket (JSON)
  each app = sandboxed <iframe srcdoc>              │
        ▲ postMessage (events)   ▼ render           │
        └───────────── bridge.js ┘                  ▼
                          Agent Bridge (Node + Fastify)
                          prompt builder · sanitizer · App Cache
                                      │
                                      ▼
                          local Claude Code (Agent SDK)
```

- **`shell/`** — the desktop: Vanilla TypeScript + Vite. Window manager, dock, menu
  bar, Spotlight (⌘K), Launchpad, and the WebSocket client to the agent.
- **`server/`** — the Agent Bridge: Node + Fastify. Calls local Claude Code, builds
  prompts, sanitizes the generated HTML, wraps it into a sandboxed iframe document,
  and holds the app cache, page cache and virtual filesystem.
- **`design-system/`** — a macOS-style CSS component library plus the agent output
  contract (`ds-prompt.md`) and the iframe wrapper/bridge.
- **`prompts/`** — the base system prompt for the generation agent.

### How a window works

1. Launching an app sends a *brief* to the Agent Bridge over WebSocket (a cache hit
   returns instantly; otherwise the current filesystem listing is included).
2. The agent streams an HTML body built from the Design System classes (plus its
   own `<script>` for local interactivity) and app metadata (name, icon). The shell
   renders the stream progressively.
3. The server sanitizes it and inlines it into an iframe document
   (`sandbox="allow-scripts"`, CSP `default-src 'none'` → **no network access**).
4. Clicking elements marked `data-action` posts an event back to the shell. The
   agent updates the app — navigation does a full (cached) render; other actions are
   patched into the DOM in place to preserve focus/scroll. Each window keeps its own
   Claude session, so apps remember their state, and file writes (via a `vibe-fs`
   trailer) persist to the shared filesystem.

### Security model

The **iframe sandbox is the security boundary**: app JavaScript runs with no
same-origin access (no parent DOM, cookies or storage) and a CSP that forbids all
network requests. It can only touch its own DOM. The server also runs the agent in
isolation (`settingSources: []`, `strictMcpConfig`, tools disabled) and listens on
localhost only.

## Requirements

- Node.js 18+
- [Claude Code](https://claude.com/claude-code) installed and logged in
  (`claude` on your `PATH`). VibeOs uses that login — no API key needed.

## Run (dev)

```bash
npm install        # installs all workspaces
npm run dev        # starts the shell (Vite) and the Agent Bridge together
```

- Shell:  http://localhost:5173
- Agent Bridge: http://localhost:8787 (`GET /health`)

Run them separately with `npm run dev:shell` / `npm run dev:server`.

## Shortcuts

| Key | Action |
|-----|--------|
| **⌘K** | Spotlight — search or generate any app (⌘+Space is reserved by macOS) |
| **⌘J** | Regenerate the active app from scratch |
| 🚀 (dock) | Launchpad — grid of all apps |
| Drag to edge | Snap a window to a half/quarter; drag to the top to maximize |
| Right-click desktop | New app, Launchpad, change wallpaper |

## Tech

Vanilla TypeScript · Vite · Fastify · WebSocket · `@anthropic-ai/claude-agent-sdk`
· `sanitize-html`. No frontend framework — the heavy lifting lives inside the
generated iframes.

## Status

A working prototype. Window management (drag/resize/snap/animations), streamed app
generation, hybrid interactivity with in-place DOM patching, a shared virtual
filesystem, app/page caching, Spotlight, Launchpad, working menus, session restore
and model tiering all function. Built as an experiment.
