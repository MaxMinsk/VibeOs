import { SERVER_URL } from "../config";

type AgentState = "online" | "offline";

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

export interface MenuBarHandle {
  el: HTMLElement;
  /** Set the focused app's name (null → idle "Finder"). */
  setActiveApp: (title: string | null) => void;
}

/** Builds the top menu bar and wires the clock + agent status poller. */
export function createMenuBar(onSearch: () => void): MenuBarHandle {
  const bar = document.createElement("div");
  bar.className = "menubar";
  bar.innerHTML = `
    <div class="menubar-left">
      <span class="menubar-logo"></span>
      <span class="menubar-app">Finder</span>
      <span class="menubar-item">File</span>
      <span class="menubar-item">Edit</span>
      <span class="menubar-item">View</span>
      <span class="menubar-item">Window</span>
      <span class="menubar-item">Help</span>
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

  bar.querySelector<HTMLElement>(".menubar-search")!.addEventListener(
    "click",
    onSearch,
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
    appEl.textContent = title ?? "Finder";
  };

  return { el: bar, setActiveApp };
}
