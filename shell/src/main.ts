import "./style.css";
import { createMenuBar } from "./desktop/menubar";
import { createDock } from "./desktop/dock";
import { WindowManager } from "./window-manager/manager";
import { AgentClient } from "./agent/client";
import { Spotlight } from "./desktop/spotlight";
import { Launchpad } from "./desktop/launchpad";
import { openMenu } from "./desktop/menu";
import type { AppDef } from "./apps";

const desktop = document.querySelector<HTMLDivElement>("#desktop")!;

// ---- Wallpapers (cycled via the desktop context menu) ----
const WALLPAPERS = [
  `radial-gradient(120% 80% at 75% 15%, rgba(255,180,220,.55), transparent 60%),
   radial-gradient(110% 90% at 20% 85%, rgba(120,170,255,.55), transparent 55%),
   linear-gradient(160deg,#6a4ea0,#8a5fb0 40%,#c66fa0)`,
  `radial-gradient(100% 80% at 20% 20%, rgba(120,210,255,.6), transparent 60%),
   linear-gradient(160deg,#0b3d6b,#1f7a8c 50%,#2bb3a3)`,
  `radial-gradient(120% 90% at 80% 10%, rgba(255,200,120,.6), transparent 60%),
   linear-gradient(160deg,#ff7e5f,#feb47b 60%,#ffd194)`,
  `radial-gradient(100% 90% at 30% 80%, rgba(180,120,255,.55), transparent 55%),
   linear-gradient(160deg,#141e30,#243b55)`,
];
let wp = Number(localStorage.getItem("vibe-wp") ?? 0) % WALLPAPERS.length;
const applyWallpaper = () => (desktop.style.background = WALLPAPERS[wp]);
const cycleWallpaper = () => {
  wp = (wp + 1) % WALLPAPERS.length;
  localStorage.setItem("vibe-wp", String(wp));
  applyWallpaper();
};
applyWallpaper();

// ---- Agent bridge ----
const agent = new AgentClient();
agent.connect();

// ---- Window layer ----
const windowLayer = document.createElement("div");
windowLayer.className = "window-layer";

// ---- Dock + menu bar (callbacks close over wm/spotlight/launchpad below) ----
const dock = createDock(
  (app: AppDef) => wm.activateApp(app),
  () => void launchpad.show(),
  (appId: string) => wm.focusApp(appId),
);

const menubar = createMenuBar({
  newApp: () => void spotlight.show(),
  launchpad: () => void launchpad.show(),
  about: () =>
    wm.launchBrief(
      "About This VibeOs — a window describing VibeOs, an AI operating system whose apps are HTML hallucinated on the fly by a local AI agent. Mention version 0.1, credits, and a short blurb.",
      "About This VibeOs",
      "ℹ️",
    ),
  help: () =>
    wm.launchBrief(
      "VibeOs Help — a help app with searchable topics explaining how to launch apps (⌘K Spotlight, dock, Launchpad), regenerate an app (⌘J), and that apps are generated on demand.",
      "VibeOs Help",
      "❓",
    ),
  closeActive: () => wm.closeActive(),
  minimizeActive: () => wm.minimizeActive(),
  zoomActive: () => wm.zoomActive(),
  regenerateActive: () => wm.regenerateActive(),
});

const wm = new WindowManager(windowLayer, dock.tray, agent, {
  onActiveChange: (title) => menubar.setActiveApp(title),
  onRunningChange: (running) => dock.setRunning(running),
});

const spotlight = new Spotlight((brief, title, glyph) =>
  wm.launchBrief(brief, title, glyph),
);
const launchpad = new Launchpad((brief, title, glyph) =>
  wm.launchBrief(brief, title, glyph),
);

// ---- Compose ----
desktop.appendChild(menubar.el);
desktop.appendChild(windowLayer);
desktop.appendChild(dock.el);

// Re-open the previous session's windows (cache hits make this instant).
wm.restoreSession();

// ---- Desktop context menu (right-click empty desktop) ----
windowLayer.addEventListener("contextmenu", (e) => {
  if (e.target !== windowLayer) return; // only on empty desktop, not windows
  e.preventDefault();
  openMenu(
    [
      { label: "New App…", shortcut: "⌘K", action: () => void spotlight.show() },
      { label: "Open Launchpad", action: () => void launchpad.show() },
      { separator: true },
      { label: "Change Wallpaper", action: cycleWallpaper },
      { separator: true },
      {
        label: "About This VibeOs",
        action: () =>
          wm.launchBrief("About This VibeOs", "About This VibeOs", "ℹ️"),
      },
    ],
    e.clientX,
    e.clientY,
  );
});

// ---- Global shortcuts (⌘+Space is taken by macOS, so we use ⌘K / ⌘J) ----
window.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    spotlight.toggle();
  } else if (e.metaKey && e.key.toLowerCase() === "j") {
    e.preventDefault();
    wm.regenerateActive();
  }
});
