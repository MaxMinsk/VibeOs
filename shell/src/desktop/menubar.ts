import { SERVER_URL } from "../config";
import { openMenu, closeMenus, isMenuOpen, type MenuItem } from "./menu";

type AgentState = "online" | "offline";

/** Commands the menu bar invokes (wired to the window manager / launchers). */
export interface MenuCommands {
  newApp: () => void;
  launchpad: () => void;
  about: () => void;
  help: () => void;
  closeActive: () => void;
  minimizeActive: () => void;
  zoomActive: () => void;
  regenerateActive: () => void;
}

export interface MenuBarHandle {
  el: HTMLElement;
  /** Set the focused app's name (null → idle "Finder"). */
  setActiveApp: (title: string | null) => void;
}

function formatClock(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Builds the top menu bar: working dropdown menus, clock, agent status. */
export function createMenuBar(cmd: MenuCommands): MenuBarHandle {
  let activeTitle: string | null = null;
  const has = () => activeTitle !== null;

  const bar = document.createElement("div");
  bar.className = "menubar";
  bar.innerHTML = `
    <div class="menubar-left">
      <button class="mb-title mb-apple" data-menu="apple"></button>
      <span class="menubar-app">Finder</span>
      <button class="mb-title" data-menu="file">File</button>
      <button class="mb-title" data-menu="edit">Edit</button>
      <button class="mb-title" data-menu="view">View</button>
      <button class="mb-title" data-menu="window">Window</button>
      <button class="mb-title" data-menu="help">Help</button>
    </div>
    <div class="menubar-right">
      <button class="menubar-search" title="Search (⌘K)" aria-label="Search">🔍</button>
      <span class="agent-status" data-state="offline">
        <span class="agent-dot"></span>
        <span class="agent-label">agent</span>
      </span>
      <span class="menubar-clock"></span>
    </div>
  `;

  const menuFor = (id: string): MenuItem[] => {
    switch (id) {
      case "apple":
        return [
          { label: "About This VibeOs", action: cmd.about },
          { separator: true },
          { label: "Regenerate App", shortcut: "⌘J", action: cmd.regenerateActive, disabled: !has() },
        ];
      case "file":
        return [
          { label: "New App…", shortcut: "⌘K", action: cmd.newApp },
          { label: "Open Launchpad", action: cmd.launchpad },
          { separator: true },
          { label: "Close Window", action: cmd.closeActive, disabled: !has() },
        ];
      case "edit":
        return [
          { label: "Undo", shortcut: "⌘Z", disabled: true },
          { label: "Redo", shortcut: "⇧⌘Z", disabled: true },
          { separator: true },
          { label: "Cut", shortcut: "⌘X", disabled: true },
          { label: "Copy", shortcut: "⌘C", disabled: true },
          { label: "Paste", shortcut: "⌘V", disabled: true },
        ];
      case "view":
        return [
          { label: "Zoom Window", action: cmd.zoomActive, disabled: !has() },
          { label: "Open Launchpad", action: cmd.launchpad },
        ];
      case "window":
        return [
          { label: "Minimize", shortcut: "⌘M", action: cmd.minimizeActive, disabled: !has() },
          { label: "Zoom", action: cmd.zoomActive, disabled: !has() },
          { separator: true },
          { label: "Close", action: cmd.closeActive, disabled: !has() },
        ];
      case "help":
        return [{ label: "VibeOs Help", action: cmd.help }];
      default:
        return [];
    }
  };

  let openEl: HTMLElement | null = null;
  const openTitle = (el: HTMLElement) => {
    const id = el.dataset.menu!;
    const r = el.getBoundingClientRect();
    el.classList.add("open");
    openEl = el;
    openMenu(menuFor(id), r.left, r.bottom, {
      onClose: () => {
        el.classList.remove("open");
        if (openEl === el) openEl = null;
      },
    });
  };

  bar.querySelectorAll<HTMLElement>(".mb-title").forEach((el) => {
    el.addEventListener("click", () => {
      if (openEl === el) closeMenus();
      else openTitle(el);
    });
    el.addEventListener("pointerenter", () => {
      if (isMenuOpen() && openEl !== el) openTitle(el);
    });
  });

  bar.querySelector<HTMLElement>(".menubar-search")!.addEventListener(
    "click",
    cmd.newApp,
  );

  const clockEl = bar.querySelector<HTMLElement>(".menubar-clock")!;
  const tick = () => (clockEl.textContent = formatClock(new Date()));
  tick();
  setInterval(tick, 1000 * 10);

  const statusEl = bar.querySelector<HTMLElement>(".agent-status")!;
  const labelEl = bar.querySelector<HTMLElement>(".agent-label")!;
  const setStatus = (s: AgentState, label: string) => {
    statusEl.dataset.state = s;
    labelEl.textContent = label;
  };

  const pingHealth = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("online", "agent");
    } catch {
      setStatus("offline", "no agent");
    }
  };
  pingHealth();
  setInterval(pingHealth, 4000);

  const appEl = bar.querySelector<HTMLElement>(".menubar-app")!;
  const setActiveApp = (title: string | null) => {
    activeTitle = title;
    appEl.textContent = title ?? "Finder";
  };

  return { el: bar, setActiveApp };
}
