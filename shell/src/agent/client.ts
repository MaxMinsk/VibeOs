import { SERVER_URL } from "../config";
import type { ClientMessage, ServerMessage } from "./protocol";

type Handler = (msg: ServerMessage) => void;

/** WebSocket client to the Agent Bridge. Routes server messages by windowId. */
export class AgentClient {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private handlers = new Map<string, Handler>();

  connect() {
    const url = SERVER_URL.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      for (const m of this.queue) ws.send(m);
      this.queue = [];
    });
    ws.addEventListener("message", (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers.get(msg.windowId)?.(msg);
    });
    ws.addEventListener("close", () => {
      // Reconnect after a short delay (dev server restarts, etc.).
      setTimeout(() => this.connect(), 1500);
    });
  }

  on(windowId: string, handler: Handler) {
    this.handlers.set(windowId, handler);
  }

  off(windowId: string) {
    this.handlers.delete(windowId);
  }

  send(msg: ClientMessage) {
    const data = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(data);
    else this.queue.push(data);
  }
}
