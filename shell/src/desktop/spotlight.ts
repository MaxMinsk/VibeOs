import { getAllApps, scoreEntry, type AppEntry } from "../agent/apps-api";

export type Launcher = (brief: string, title: string, glyph: string) => void;

type Item =
  | { kind: "app"; entry: AppEntry }
  | { kind: "generate"; query: string };

/** ⌘K launcher overlay: type any app name to launch or generate it. */
export class Spotlight {
  private readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly listEl: HTMLElement;
  private apps: AppEntry[] = [];
  private items: Item[] = [];
  private selected = 0;
  private open = false;

  constructor(private readonly launch: Launcher) {
    this.root = document.createElement("div");
    this.root.className = "spotlight";
    this.root.innerHTML = `
      <div class="spotlight-box">
        <div class="spotlight-search">
          <span class="spotlight-icon">🔍</span>
          <input class="spotlight-input" type="text" spellcheck="false"
            placeholder="Search apps, or describe one to generate…" />
        </div>
        <div class="spotlight-list"></div>
      </div>
    `;
    this.input = this.root.querySelector(".spotlight-input")!;
    this.listEl = this.root.querySelector(".spotlight-list")!;

    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    document.body.appendChild(this.root);
  }

  async show() {
    this.open = true;
    this.root.classList.add("visible");
    this.input.value = "";
    this.input.focus();
    this.apps = await getAllApps();
    this.render();
  }

  close() {
    this.open = false;
    this.root.classList.remove("visible");
  }

  toggle() {
    this.open ? this.close() : void this.show();
  }

  private compute(): Item[] {
    const q = this.input.value.trim();
    const scored = this.apps
      .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
      .filter((s) => s.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // cached first, then recency
        if (a.entry.source !== b.entry.source)
          return a.entry.source === "cached" ? -1 : 1;
        return (b.entry.lastOpened ?? "").localeCompare(a.entry.lastOpened ?? "");
      });

    const items: Item[] = scored.map((s) => ({ kind: "app", entry: s.entry }));

    // Offer generation when the query isn't an exact existing app name.
    const exact = scored.some((s) => s.score >= 100);
    if (q && !exact) items.push({ kind: "generate", query: q });
    return items;
  }

  private render() {
    this.items = this.compute();
    if (this.selected >= this.items.length) this.selected = 0;
    this.listEl.innerHTML = this.items
      .map((it, i) => {
        const sel = i === this.selected ? " selected" : "";
        if (it.kind === "generate") {
          return `<div class="spot-row generate${sel}" data-i="${i}">
            <span class="spot-glyph">✦</span>
            <span class="spot-main"><span class="spot-name">Generate “${escapeHtml(it.query)}”</span>
            <span class="spot-sub">Create a new app with the agent</span></span>
          </div>`;
        }
        const e = it.entry;
        const tag = e.source === "cached" ? "cached" : "app";
        return `<div class="spot-row${sel}" data-i="${i}">
          <span class="spot-glyph">${e.glyph}</span>
          <span class="spot-main"><span class="spot-name">${escapeHtml(e.name)}</span>
          <span class="spot-sub">${escapeHtml(e.brief)}</span></span>
          <span class="spot-tag">${tag}</span>
        </div>`;
      })
      .join("");

    this.listEl.querySelectorAll<HTMLElement>(".spot-row").forEach((row) => {
      row.addEventListener("pointerenter", () => {
        this.selected = Number(row.dataset.i);
        this.highlight();
      });
      row.addEventListener("click", () => {
        this.selected = Number(row.dataset.i);
        this.activate();
      });
    });
  }

  private highlight() {
    this.listEl.querySelectorAll<HTMLElement>(".spot-row").forEach((r, i) => {
      r.classList.toggle("selected", i === this.selected);
    });
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") return this.close();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.selected = Math.min(this.selected + 1, this.items.length - 1);
      this.highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.selected = Math.max(this.selected - 1, 0);
      this.highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.activate();
    }
  }

  private activate() {
    const it = this.items[this.selected];
    if (!it) {
      const q = this.input.value.trim();
      if (q) this.launch(q, q, "✦");
    } else if (it.kind === "generate") {
      this.launch(it.query, it.query, "✦");
    } else {
      this.launch(it.entry.brief, it.entry.name, it.entry.glyph);
    }
    this.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
