import {
  type Geometry,
  type WindowState,
  type WindowHandlers,
  MIN_W,
  MIN_H,
} from "./types";

const RESIZE_DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type ResizeDir = (typeof RESIZE_DIRS)[number];

/** DOM + interaction (drag/resize) for a single window. */
export class WindowView {
  readonly el: HTMLElement;
  private readonly titlebar: HTMLElement;
  private readonly iframe: HTMLIFrameElement;
  private readonly overlay: HTMLElement;
  private readonly streambar: HTMLElement;
  private readonly titleEl: HTMLElement;

  constructor(
    readonly state: WindowState,
    private readonly layer: HTMLElement,
    private readonly handlers: WindowHandlers,
  ) {
    this.el = document.createElement("div");
    this.el.className = "window";
    this.el.dataset.id = state.id;
    this.el.innerHTML = `
      <div class="titlebar">
        <div class="traffic-lights">
          <button class="tl tl-close" aria-label="Close"></button>
          <button class="tl tl-min" aria-label="Minimize"></button>
          <button class="tl tl-max" aria-label="Maximize"></button>
        </div>
        <div class="win-title"><span class="win-glyph">${state.glyph}</span><span class="win-name">${state.title}</span></div>
      </div>
      <div class="window-body">
        <iframe class="window-frame" sandbox="allow-scripts"
          referrerpolicy="no-referrer" title="${state.title}"></iframe>
        <div class="window-overlay">
          <div class="spinner"></div>
          <div class="overlay-text">Generating ${state.title}…</div>
        </div>
        <div class="window-streambar"></div>
      </div>
      ${RESIZE_DIRS.map((d) => `<span class="rh rh-${d}" data-dir="${d}"></span>`).join("")}
    `;

    this.titlebar = this.el.querySelector(".titlebar")!;
    this.iframe = this.el.querySelector(".window-frame")!;
    this.overlay = this.el.querySelector(".window-overlay")!;
    this.streambar = this.el.querySelector(".window-streambar")!;
    this.titleEl = this.el.querySelector(".win-name")!;
    // The bridge inside the iframe reads its window id from window.name.
    this.iframe.name = state.id;

    this.applyGeometry();
    this.applyZ();
    this.wireControls();
    this.wireFocus();
    this.wireDrag();
    this.wireResize();
    this.setLoading(true);
  }

  // ---- public API used by the manager ----
  mount() {
    this.layer.appendChild(this.el);
  }

  destroy() {
    this.el.remove();
  }

  setActive(active: boolean) {
    this.el.classList.toggle("active", active);
  }

  setHidden(hidden: boolean) {
    this.el.classList.toggle("hidden", hidden);
  }

  setMaximized(maximized: boolean) {
    this.el.classList.toggle("maximized", maximized);
  }

  applyGeometry() {
    const { x, y, w, h } = this.state.geometry;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
  }

  applyZ() {
    this.el.style.zIndex = String(this.state.zIndex);
  }

  private hasContent = false;

  /** Show a busy indicator for an update: stream bar if content already exists
   *  (keep it visible), else the full spinner overlay (first load). */
  beginUpdate() {
    if (this.hasContent) {
      this.overlay.classList.remove("visible");
      this.streambar.classList.add("visible");
    } else {
      this.setLoading(true);
    }
  }

  /** Progressive preview during streaming (no scripts/bridge yet). */
  setStreaming(srcdoc: string) {
    this.iframe.srcdoc = srcdoc;
    this.overlay.classList.remove("visible"); // reveal the UI being built
    this.streambar.classList.add("visible");
  }

  /** Replace the iframe content with the final agent-generated srcdoc. */
  setContent(srcdoc: string) {
    // Reset window.name each render (cleared when srcdoc reloads the doc).
    this.iframe.name = this.state.id;
    this.iframe.srcdoc = srcdoc;
    this.streambar.classList.remove("visible");
    this.setLoading(false);
    this.hasContent = true;
  }

  /** Patch the current document in place (preserves focus/scroll). */
  applyPatch(html: string) {
    this.iframe.contentWindow?.postMessage({ type: "vibe-patch", html }, "*");
    this.streambar.classList.remove("visible");
    this.setLoading(false);
    this.hasContent = true;
  }

  setLoading(loading: boolean, text = "Generating…") {
    if (loading) {
      this.overlay.innerHTML = `<div class="spinner"></div><div class="overlay-text">${escapeHtml(text)}</div>`;
      this.streambar.classList.remove("visible");
    }
    this.overlay.classList.toggle("visible", loading);
  }

  setTitle(name: string, glyph?: string) {
    this.state.title = name;
    this.titleEl.textContent = name;
    if (glyph) {
      this.state.glyph = glyph;
      const g = this.el.querySelector(".win-glyph");
      if (g) g.textContent = glyph;
    }
  }

  showError(message: string, onRetry?: () => void) {
    this.overlay.innerHTML = `
      <div class="overlay-error">
        <div class="overlay-error-icon">⚠️</div>
        <div class="overlay-error-title">Generation failed</div>
        <div class="overlay-error-msg">${escapeHtml(message)}</div>
        ${onRetry ? `<button class="overlay-retry">Retry</button>` : ""}
      </div>`;
    this.streambar.classList.remove("visible");
    this.overlay.classList.add("visible");
    if (onRetry) {
      this.overlay
        .querySelector(".overlay-retry")!
        .addEventListener("click", onRetry);
    }
  }

  // ---- open/close/minimize animations ----
  private afterAnim(done: () => void) {
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      done();
    };
    this.el.addEventListener("animationend", fire, { once: true });
    setTimeout(fire, 320); // fallback if animationend doesn't fire
  }

  playClose(done: () => void) {
    this.el.classList.add("closing");
    this.afterAnim(done);
  }

  /** Genie-style minimize toward a target point (the dock). */
  playMinimize(target: { x: number; y: number }, done: () => void) {
    const r = this.el.getBoundingClientRect();
    const dx = target.x - (r.left + r.width / 2);
    const dy = target.y - (r.top + r.height / 2);
    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      this.setHidden(true);
      anim.cancel();
      done();
    };
    const anim = this.el.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.1 },
      ],
      { duration: 300, easing: "cubic-bezier(.4,0,.7,1)" },
    );
    anim.onfinish = finish;
    setTimeout(finish, 360);
  }

  playRestore() {
    this.setHidden(false);
    this.el.classList.add("restoring");
    this.afterAnim(() => this.el.classList.remove("restoring"));
  }

  // ---- wiring ----
  private wireControls() {
    const stop = (e: Event) => e.stopPropagation();
    const close = this.el.querySelector<HTMLElement>(".tl-close")!;
    const min = this.el.querySelector<HTMLElement>(".tl-min")!;
    const max = this.el.querySelector<HTMLElement>(".tl-max")!;
    for (const b of [close, min, max]) b.addEventListener("pointerdown", stop);
    close.addEventListener("click", () => this.handlers.onClose(this.state.id));
    min.addEventListener("click", () => this.handlers.onMinimize(this.state.id));
    max.addEventListener("click", () =>
      this.handlers.onToggleMaximize(this.state.id),
    );
    // Double-click titlebar toggles maximize (macOS behaviour).
    this.titlebar.addEventListener("dblclick", () =>
      this.handlers.onToggleMaximize(this.state.id),
    );
  }

  private wireFocus() {
    this.el.addEventListener("pointerdown", () =>
      this.handlers.onFocus(this.state.id),
    );
  }

  private wireDrag() {
    let startX = 0,
      startY = 0,
      originX = 0,
      originY = 0;

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const bounds = this.layer.getBoundingClientRect();
      const g = this.state.geometry;
      // Keep the titlebar reachable: clamp within the layer.
      g.x = clamp(originX + dx, -g.w + 80, bounds.width - 80);
      g.y = clamp(originY + dy, 0, bounds.height - 36);
      this.applyGeometry();
    };
    const onUp = (e: PointerEvent) => {
      this.titlebar.releasePointerCapture(e.pointerId);
      this.titlebar.removeEventListener("pointermove", onMove);
      this.titlebar.removeEventListener("pointerup", onUp);
      this.layer.classList.remove("interacting");
    };

    this.titlebar.addEventListener("pointerdown", (e) => {
      if (this.state.mode === "maximized") return; // no drag while maximized
      if ((e.target as HTMLElement).closest(".tl")) return; // ignore buttons
      startX = e.clientX;
      startY = e.clientY;
      originX = this.state.geometry.x;
      originY = this.state.geometry.y;
      this.titlebar.setPointerCapture(e.pointerId);
      this.titlebar.addEventListener("pointermove", onMove);
      this.titlebar.addEventListener("pointerup", onUp);
      this.layer.classList.add("interacting");
    });
  }

  private wireResize() {
    this.el.querySelectorAll<HTMLElement>(".rh").forEach((handle) => {
      const dir = handle.dataset.dir as ResizeDir;
      let startX = 0,
        startY = 0,
        start: Geometry;

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const g = this.state.geometry;
        if (dir.includes("e")) g.w = Math.max(MIN_W, start.w + dx);
        if (dir.includes("s")) g.h = Math.max(MIN_H, start.h + dy);
        if (dir.includes("w")) {
          const w = Math.max(MIN_W, start.w - dx);
          g.x = start.x + (start.w - w);
          g.w = w;
        }
        if (dir.includes("n")) {
          const h = Math.max(MIN_H, start.h - dy);
          g.y = start.y + (start.h - h);
          g.h = h;
        }
        this.applyGeometry();
      };
      const onUp = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        this.layer.classList.remove("interacting");
      };

      handle.addEventListener("pointerdown", (e) => {
        if (this.state.mode === "maximized") return;
        e.stopPropagation();
        startX = e.clientX;
        startY = e.clientY;
        start = { ...this.state.geometry };
        handle.setPointerCapture(e.pointerId);
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", onUp);
        this.layer.classList.add("interacting");
      });
    });
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}
