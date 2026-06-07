// WebSocket protocol (mirror of server/src/protocol.ts).

export interface AppMeta {
  name?: string;
  glyph?: string;
  category?: string;
}

export type ClientMessage =
  | { type: "launch"; windowId: string; brief: string; force?: boolean }
  | {
      type: "event";
      windowId: string;
      sessionId: string | null;
      brief: string;
      action: string;
      detail: unknown;
    }
  | { type: "close"; windowId: string };

export type ServerMessage =
  | {
      type: "status";
      windowId: string;
      state: "thinking" | "ready" | "error";
      message?: string;
    }
  | { type: "chunk"; windowId: string; srcdoc: string }
  | {
      type: "render";
      windowId: string;
      srcdoc: string;
      meta: AppMeta | null;
      sessionId: string | null;
      done: boolean;
    }
  | { type: "error"; windowId: string; message: string };
