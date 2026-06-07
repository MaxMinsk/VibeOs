export type WindowMode = "normal" | "minimized" | "maximized";

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  glyph: string;
  geometry: Geometry;
  /** Saved geometry to restore from maximized state. */
  prevGeometry?: Geometry;
  zIndex: number;
  mode: WindowMode;
  /** Free-text brief used to generate this app. */
  brief: string;
  /** Claude Code session id for this window (set after first render). */
  sessionId: string | null;
}

/** Callbacks a WindowView uses to talk back to the manager. */
export interface WindowHandlers {
  onFocus(id: string): void;
  onClose(id: string): void;
  onMinimize(id: string): void;
  onToggleMaximize(id: string): void;
  /** Called after a drag/resize/snap settles (for persistence). */
  onCommit?(id: string): void;
}

export const MIN_W = 280;
export const MIN_H = 180;
export const DEFAULT_W = 640;
export const DEFAULT_H = 440;
