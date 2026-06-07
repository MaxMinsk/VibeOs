import { APPS, type AppDef } from "../apps";

export interface DockHandle {
  el: HTMLElement;
  tray: HTMLElement;
  /** Update running-indicator dots from the set of running appIds. */
  setRunning: (running: Set<string>) => void;
}

/**
 * Builds the dock with a Launchpad button, app icons (with running indicators)
 * and a tray for minimized windows.
 */
export function createDock(
  onActivate: (app: AppDef) => void,
  onLaunchpad: () => void,
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

  const divider = document.createElement("span");
  divider.className = "dock-divider";

  const tray = document.createElement("div");
  tray.className = "dock-tray";

  dock.append(apps, divider, tray);

  const setRunning = (running: Set<string>) => {
    apps.querySelectorAll<HTMLElement>(".dock-item[data-app-id]").forEach((it) => {
      it.classList.toggle("running", running.has(it.dataset.appId!));
    });
  };

  return { el: dock, tray, setRunning };
}
