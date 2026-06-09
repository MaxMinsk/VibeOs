// Shared WebSocket message protocol between shell and Agent Bridge.
// (Kept in sync with shell/src/agent/protocol.ts.)

import type { AppMeta } from "./sanitizer.js";

/** shell → server */
export type ClientMessage =
  | { type: "launch"; windowId: string; brief: string; force?: boolean }
  | {
      type: "event";
      windowId: string;
      sessionId: string | null;
      /** Brief, sent so cache-opened windows (no session) can re-establish context. */
      brief: string;
      action: string;
      detail: unknown;
    }
  | { type: "close"; windowId: string };

/** server → shell */
export type ServerMessage =
  | {
      type: "status";
      windowId: string;
      state: "thinking" | "ready" | "error";
      message?: string;
    }
  | { type: "chunk"; windowId: string; srcdoc: string }
  | { type: "patch"; windowId: string; html: string }
  | { type: "patch-region"; windowId: string; target: string; html: string }
  | {
      type: "render";
      windowId: string;
      srcdoc: string;
      meta: AppMeta | null;
      sessionId: string | null;
      done: boolean;
    }
  | { type: "error"; windowId: string; message: string };
