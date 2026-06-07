import "./style.css";
import { createMenuBar } from "./desktop/menubar";
import { createDock } from "./desktop/dock";
import { WindowManager } from "./window-manager/manager";
import { AgentClient } from "./agent/client";
import { Spotlight } from "./desktop/spotlight";
import { Launchpad } from "./desktop/launchpad";
import type { AppDef } from "./apps";

const desktop = document.querySelector<HTMLDivElement>("#desktop")!;

// Agent bridge connection.
const agent = new AgentClient();
agent.connect();

// Window layer.
const windowLayer = document.createElement("div");
windowLayer.className = "window-layer";

// Menu bar + dock (callbacks close over wm/launchpad declared below).
const menubar = createMenuBar(() => void spotlight.show());
const dock = createDock(
  (app: AppDef) => wm.activateApp(app),
  () => void launchpad.show(),
);

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

// Compose the desktop.
desktop.appendChild(menubar.el);
desktop.appendChild(windowLayer);
desktop.appendChild(dock.el);

// Global shortcuts (⌘+Space is taken by macOS, so we use ⌘K / ⌘J).
window.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    spotlight.toggle();
  } else if (e.metaKey && e.key.toLowerCase() === "j") {
    e.preventDefault();
    wm.regenerateActive();
  }
});
