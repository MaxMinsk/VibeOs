import { APPS, type AppDef } from "../apps";

export interface RunningApp {
  appId: string;
  name: string;
  glyph: string;
}

export interface DockHandle {
  el: HTMLElement;
  tray: HTMLElement;
  /** Reflect currently running apps: pinned ones light up, others appear as
   *  temporary icons. */
  setRunning: (running: RunningApp[]) => void;
}

const PINNED_IDS = new Set(APPS.map((a) => a.id));

/**
 * Builds the dock: Launchpad button, pinned app icons (with running indicators),
 * a section for running non-pinned (generated) apps, and a minimized-window tray.
 */
export function createDock(
  onActivate: (app: AppDef) => void,
  onLaunchpad: () => void,
  onFocusApp: (appId: string) => void,
): DockHandle {
  const dock = document.createElement("div");
  dock.className = "dock";

  const apps = document.createElement("div");
  apps.className = "dock-apps";

  // Launchpad button (leftmost, not an agent app).
  const lp = document.createElement("button");
  lp.className = "dock-item";
  lp.title = "Launchpad";
  lp.setAttribute("aria-label", "Launchpad");
  lp.innerHTML = `
    <span class="dock-icon" style="background:linear-gradient(160deg,#8a8f98,#5b5f66)">🚀</span>
    <span class="dock-tooltip">Launchpad</span>
  `;
  lp.addEventListener("click", onLaunchpad);
  apps.appendChild(lp);

  for (const app of APPS) {
    const item = document.createElement("button");
    item.className = "dock-item";
    item.dataset.appId = app.id;
    item.title = app.name;
    item.setAttribute("aria-label", app.name);
    item.innerHTML = `
      <span class="dock-icon" style="background:${app.gradient}">${app.glyph}</span>
      <span class="dock-tooltip">${app.name}</span>
      <span class="dock-run"></span>
    `;
    item.addEventListener("click", () => onActivate(app));
    apps.appendChild(item);
  }

  // Running non-pinned (generated) apps live here.
  const running = document.createElement("div");
  running.className = "dock-running";

  const divider = document.createElement("span");
  divider.className = "dock-divider";

  const tray = document.createElement("div");
  tray.className = "dock-tray";

  dock.append(apps, running, divider, tray);

  const setRunning = (list: RunningApp[]) => {
    const runningIds = new Set(list.map((a) => a.appId));

    // Pinned apps: toggle the running dot.
    apps.querySelectorAll<HTMLElement>(".dock-item[data-app-id]").forEach((it) => {
      it.classList.toggle("running", runningIds.has(it.dataset.appId!));
    });

    // Non-pinned running apps: temporary dock icons.
    const want = list.filter((a) => !PINNED_IDS.has(a.appId));
    const wantIds = new Set(want.map((a) => a.appId));
    // Remove stale temp icons.
    running.querySelectorAll<HTMLElement>(".dock-item").forEach((it) => {
      if (!wantIds.has(it.dataset.appId!)) it.remove();
    });
    // Add/refresh temp icons.
    for (const a of want) {
      let it = running.querySelector<HTMLElement>(`.dock-item[data-app-id="${CSS.escape(a.appId)}"]`);
      if (!it) {
        it = document.createElement("button");
        it.className = "dock-item running";
        it.dataset.appId = a.appId;
        it.addEventListener("click", () => onFocusApp(a.appId));
        running.appendChild(it);
      }
      it.title = a.name;
      it.innerHTML = `
        <span class="dock-icon dock-icon--gen">${a.glyph}</span>
        <span class="dock-tooltip">${a.name}</span>
        <span class="dock-run"></span>
      `;
    }
    running.classList.toggle("has-items", want.length > 0);
  };

  return { el: dock, tray, setRunning };
}
