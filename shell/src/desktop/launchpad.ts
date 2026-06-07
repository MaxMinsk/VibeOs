import { getAllApps, scoreEntry, type AppEntry } from "../agent/apps-api";
import type { Launcher } from "./spotlight";

/** Full-screen grid of all apps (built-in + cached). */
export class Launchpad {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly grid: HTMLElement;
  private apps: AppEntry[] = [];
  private open = false;

  constructor(private readonly launch: Launcher) {
    this.root = document.createElement("div");
    this.root.className = "launchpad";
    this.root.innerHTML = `
      <div class="launchpad-search">
        <input class="launchpad-input" type="text" spellcheck="false" placeholder="Search" />
      </div>
      <div class="launchpad-grid"></div>
    `;
    this.input = this.root.querySelector(".launchpad-input")!;
    this.grid = this.root.querySelector(".launchpad-grid")!;

    this.root.addEventListener("pointerdown", (e) => {
      // Click on empty backdrop (not a tile/search) closes.
      const t = e.target as HTMLElement;
      if (!t.closest(".lp-tile") && !t.closest(".launchpad-search")) this.close();
    });
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      if (e.key === "Enter") {
        const first = this.filtered()[0];
        if (first) this.pick(first);
      }
    });
    document.body.appendChild(this.root);
  }

  async show() {
    this.open = true;
    this.root.classList.add("visible");
    this.input.value = "";
    this.apps = await getAllApps();
    this.render();
    this.input.focus();
  }

  close() {
    this.open = false;
    this.root.classList.remove("visible");
  }

  toggle() {
    this.open ? this.close() : void this.show();
  }

  private filtered(): AppEntry[] {
    const q = this.input.value.trim();
    return this.apps
      .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
      .map((s) => s.entry);
  }

  private render() {
    const apps = this.filtered();
    this.grid.innerHTML = apps
      .map(
        (e, i) => `
        <button class="lp-tile" data-i="${i}">
          <span class="lp-icon">${e.glyph}</span>
          <span class="lp-name">${escapeHtml(e.name)}</span>
        </button>`,
      )
      .join("");
    this.grid.querySelectorAll<HTMLElement>(".lp-tile").forEach((tile) => {
      tile.addEventListener("click", () => this.pick(apps[Number(tile.dataset.i)]));
    });
  }

  private pick(e: AppEntry) {
    this.launch(e.brief, e.name, e.glyph);
    this.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
