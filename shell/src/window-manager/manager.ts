import type { AppDef } from "../apps";
import { WindowView } from "./window-view";
import type { AgentClient } from "../agent/client";
import type { ServerMessage, ClientMessage } from "../agent/protocol";
import type { RunningApp } from "../desktop/dock";
import { sound } from "../desktop/sound";
import {
  type Geometry,
  type WindowState,
  DEFAULT_W,
  DEFAULT_H,
} from "./types";

let seq = 0;
const nextId = () => `win-${++seq}`;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "app";

/**
 * Owns all windows: lifecycle, z-index/focus, minimize tray. The single source
 * of truth is each WindowState (shared by reference with its WindowView).
 */
export interface WindowManagerHooks {
  /** Title of the focused app (or null when none). */
  onActiveChange?: (title: string | null) => void;
  /** Apps that currently have at least one open window (one per appId). */
  onRunningChange?: (running: RunningApp[]) => void;
}

export class WindowManager {
  private readonly views = new Map<string, WindowView>();
  private readonly lastEvent = new Map<string, ClientMessage>();
  private nextZ = 100;
  private activeId: string | null = null;
  private cascade = 0;

  constructor(
    private readonly layer: HTMLElement,
    /** Container in the dock where minimized windows appear. */
    private readonly tray: HTMLElement,
    private readonly agent: AgentClient,
    private readonly hooks: WindowManagerHooks = {},
  ) {
    // Route interaction events coming from app iframes back to the agent.
    window.addEventListener("message", (e) => this.onIframeMessage(e));
  }

  /** Dock click: focus an existing window for this app, else open one. */
  activateApp(app: AppDef): string {
    let target: WindowView | null = null;
    for (const v of this.views.values()) {
      if (v.state.appId !== app.id) continue;
      if (!target || v.state.zIndex > target.state.zIndex) target = v;
    }
    if (target) {
      this.focus(target.state.id);
      return target.state.id;
    }
    return this.launch(app);
  }

  /** Open a window for a dock app (uses its curated brief, falls back to name). */
  launch(app: AppDef): string {
    return this.open({
      appId: app.id,
      title: app.name,
      glyph: app.glyph,
      brief: app.brief ?? app.name,
    });
  }

  /** Open a window from a free-text brief (Spotlight, M8). */
  launchBrief(brief: string, title = brief, glyph = "✦"): string {
    return this.open({ appId: slug(brief), title, glyph, brief });
  }

  private open(
    init: { appId: string; title: string; glyph: string; brief: string },
    restore?: { geometry?: Geometry; mode?: WindowState["mode"] },
  ): string {
    const id = nextId();
    const state: WindowState = {
      id,
      appId: init.appId,
      title: init.title,
      glyph: init.glyph,
      geometry: restore?.geometry ?? this.nextGeometry(),
      zIndex: ++this.nextZ,
      mode: "normal",
      brief: init.brief,
      sessionId: null,
    };

    const view = new WindowView(state, this.layer, {
      onFocus: (wid) => this.focus(wid),
      onClose: (wid) => this.close(wid),
      onMinimize: (wid) => this.minimize(wid),
      onToggleMaximize: (wid) => this.toggleMaximize(wid),
      onCommit: () => this.persist(),
    });
    this.views.set(id, view);
    view.mount();
    if (restore?.mode === "maximized") this.toggleMaximize(id);
    this.focus(id);
    if (!restore) sound.open();

    // Wire agent responses for this window, then request the initial UI.
    this.agent.on(id, (msg) => this.onServerMessage(msg));
    this.agent.send({ type: "launch", windowId: id, brief: state.brief });
    return id;
  }

  private onServerMessage(msg: ServerMessage) {
    const view = this.views.get(msg.windowId);
    if (!view) return;
    if (msg.type === "status") {
      if (msg.state === "thinking") view.beginUpdate();
      if (msg.state === "error")
        view.showError(msg.message ?? "error", () => this.retry(msg.windowId));
    } else if (msg.type === "chunk") {
      view.setStreaming(msg.srcdoc);
    } else if (msg.type === "patch") {
      view.applyPatch(msg.html);
    } else if (msg.type === "patch-region") {
      view.applyRegionPatch(msg.target, msg.html);
    } else if (msg.type === "render") {
      if (msg.meta?.name) {
        view.setTitle(msg.meta.name, msg.meta.glyph);
        if (this.activeId === msg.windowId) this.emitChange();
      }
      view.state.sessionId = msg.sessionId;
      view.setContent(msg.srcdoc);
    } else if (msg.type === "error") {
      view.showError(msg.message, () => this.retry(msg.windowId));
    }
  }

  /** Re-request the initial UI for a window after an error. */
  retry(id: string) {
    const view = this.views.get(id);
    if (!view) return;
    view.setLoading(true, `Generating ${view.state.title}…`);
    this.agent.send({ type: "launch", windowId: id, brief: view.state.brief });
  }

  private onIframeMessage(e: MessageEvent) {
    const data = e.data;
    if (!data) return;
    if (data.type === "vibe-event") {
      const view = this.views.get(data.windowId);
      if (!view) return;
      view.beginUpdate();
      const msg: ClientMessage = {
        type: "event",
        windowId: data.windowId,
        sessionId: view.state.sessionId,
        brief: view.state.brief,
        action: data.event?.action,
        detail: data.event,
      };
      this.lastEvent.set(data.windowId, msg);
      this.agent.send(msg);
    } else if (data.type === "vibe-region-miss") {
      // The targeted region wasn't found → recover with a full re-render.
      const view = this.views.get(data.windowId);
      const prev = this.lastEvent.get(data.windowId);
      if (!view || !prev || prev.type !== "event") return;
      view.beginUpdate();
      this.agent.send({ ...prev, forceFull: true });
    }
  }

  closeActive() {
    if (this.activeId) this.close(this.activeId);
  }
  minimizeActive() {
    if (this.activeId) this.minimize(this.activeId);
  }
  zoomActive() {
    if (this.activeId) this.toggleMaximize(this.activeId);
  }

  /** Forget the active window's cached app and regenerate it in place (⌘J). */
  regenerateActive() {
    if (!this.activeId) return;
    const view = this.views.get(this.activeId);
    if (!view) return;
    view.state.sessionId = null;
    view.setLoading(true, `Regenerating ${view.state.title}…`);
    this.agent.send({
      type: "launch",
      windowId: view.state.id,
      brief: view.state.brief,
      force: true,
    });
  }

  focus(id: string) {
    const view = this.views.get(id);
    if (!view) return;
    if (view.state.mode === "minimized") this.restore(id);
    view.state.zIndex = ++this.nextZ;
    view.applyZ();
    if (this.activeId !== id) {
      this.activeId = id;
      for (const [vid, v] of this.views) v.setActive(vid === id);
    }
    this.emitChange();
  }

  close(id: string) {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    this.removeTrayItem(id);
    this.agent.send({ type: "close", windowId: id });
    this.agent.off(id);
    sound.close();
    view.playClose(() => view.destroy());
    if (this.activeId === id) {
      this.activeId = null;
      this.focusTopmost();
    }
    this.emitChange();
  }

  minimize(id: string) {
    const view = this.views.get(id);
    if (!view || view.state.mode === "minimized") return;
    view.state.mode = "minimized";
    sound.minimize();
    view.playMinimize(this.minimizeTarget(), () => {});
    this.addTrayItem(view.state);
    if (this.activeId === id) {
      this.activeId = null;
      this.focusTopmost();
    }
    this.emitChange();
  }

  restore(id: string) {
    const view = this.views.get(id);
    if (!view || view.state.mode !== "minimized") return;
    view.state.mode = "normal";
    view.playRestore();
    this.removeTrayItem(id);
  }

  toggleMaximize(id: string) {
    const view = this.views.get(id);
    if (!view) return;
    const s = view.state;
    if (s.mode === "maximized") {
      if (s.prevGeometry) s.geometry = { ...s.prevGeometry };
      s.mode = "normal";
      view.setMaximized(false);
    } else {
      s.prevGeometry = { ...s.geometry };
      const b = this.layer.getBoundingClientRect();
      s.geometry = { x: 0, y: 0, w: b.width, h: b.height };
      s.mode = "maximized";
      view.setMaximized(true);
    }
    view.applyGeometry();
    this.focus(id);
  }

  /** Where minimized windows fly to (the dock tray / bottom-centre). */
  private minimizeTarget(): { x: number; y: number } {
    const tr = this.tray.getBoundingClientRect();
    return {
      x: tr.width ? tr.left + tr.width / 2 : window.innerWidth / 2,
      y: window.innerHeight - 24,
    };
  }

  // ---- session persistence ----
  private persist() {
    const wins = [...this.views.values()]
      .filter((v) => v.state.mode !== "minimized")
      .sort((a, b) => a.state.zIndex - b.state.zIndex)
      .map((v) => ({
        appId: v.state.appId,
        title: v.state.title,
        glyph: v.state.glyph,
        brief: v.state.brief,
        geometry: v.state.geometry,
        mode: v.state.mode,
      }));
    try {
      localStorage.setItem("vibe-session", JSON.stringify(wins));
    } catch {
      /* ignore */
    }
  }

  /** Re-open the windows from the last session (cache hits make this instant). */
  restoreSession() {
    let saved: Array<{
      appId: string;
      title: string;
      glyph: string;
      brief: string;
      geometry: Geometry;
      mode: WindowState["mode"];
    }>;
    try {
      saved = JSON.parse(localStorage.getItem("vibe-session") || "[]");
    } catch {
      return;
    }
    for (const w of saved) {
      this.open(
        { appId: w.appId, title: w.title, glyph: w.glyph, brief: w.brief },
        { geometry: w.geometry, mode: w.mode === "maximized" ? "maximized" : undefined },
      );
    }
  }

  // ---- helpers ----
  private emitChange() {
    this.persist();
    const byApp = new Map<string, RunningApp>();
    for (const v of this.views.values()) {
      if (!byApp.has(v.state.appId))
        byApp.set(v.state.appId, {
          appId: v.state.appId,
          name: v.state.title,
          glyph: v.state.glyph,
        });
    }
    this.hooks.onRunningChange?.([...byApp.values()]);
    const title = this.activeId
      ? (this.views.get(this.activeId)?.state.title ?? null)
      : null;
    this.hooks.onActiveChange?.(title);
  }

  /** Focus the topmost window of a running app (used by dock running icons). */
  focusApp(appId: string) {
    let top: WindowView | null = null;
    for (const v of this.views.values()) {
      if (v.state.appId !== appId) continue;
      if (!top || v.state.zIndex > top.state.zIndex) top = v;
    }
    if (top) this.focus(top.state.id);
  }

  private focusTopmost() {
    let top: WindowView | null = null;
    for (const v of this.views.values()) {
      if (v.state.mode === "minimized") continue;
      if (!top || v.state.zIndex > top.state.zIndex) top = v;
    }
    if (top) this.focus(top.state.id);
  }

  private nextGeometry(): Geometry {
    const b = this.layer.getBoundingClientRect();
    const step = 28;
    const off = (this.cascade % 6) * step;
    this.cascade++;
    const x = Math.max(20, Math.round((b.width - DEFAULT_W) / 2 - 60) + off);
    const y = Math.max(20, 40 + off);
    return { x, y, w: DEFAULT_W, h: DEFAULT_H };
  }

  private addTrayItem(state: WindowState) {
    const pill = document.createElement("button");
    pill.className = "tray-item";
    pill.dataset.id = state.id;
    pill.title = state.title;
    pill.innerHTML = `<span class="tray-glyph">${state.glyph}</span><span class="tray-title">${state.title}</span>`;
    pill.addEventListener("click", () => this.focus(state.id));
    this.tray.appendChild(pill);
    this.tray.classList.add("has-items");
  }

  private removeTrayItem(id: string) {
    this.tray.querySelector(`.tray-item[data-id="${id}"]`)?.remove();
    if (!this.tray.children.length) this.tray.classList.remove("has-items");
  }
}
