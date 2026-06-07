import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { HOST, PORT, ALLOWED_ORIGINS, CLAUDE_BIN } from "./config.js";
import { runApp } from "./claude-runner.js";
import {
  buildLaunchPrompt,
  buildEventPrompt,
  buildFirstEventPrompt,
} from "./prompt-builder.js";
import { sanitizeApp, sanitizePreview } from "./sanitizer.js";
import { buildSrcDoc, buildPreviewDoc } from "./wrapper.js";
import { appCache } from "./app-cache.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: ALLOWED_ORIGINS });
await app.register(websocket);

app.get("/health", async () => ({
  ok: true,
  service: "vibeos-agent-bridge",
  version: "0.1.0",
  claudeBin: CLAUDE_BIN,
  ts: new Date().toISOString(),
}));

// Cached apps — powers Launchpad and Spotlight autocomplete (M8).
app.get("/apps", async () =>
  appCache.list().map((a) => ({
    key: a.key,
    brief: a.brief,
    name: a.name,
    glyph: a.glyph,
    category: a.category,
    opens: a.opens,
    lastOpened: a.lastOpened,
  })),
);

// Forget a cached app (Launchpad "remove").
app.delete<{ Params: { key: string } }>("/apps/:key", async (req) => ({
  ok: appCache.remove(req.params.key),
}));

app.register(async (f) => {
  f.get("/ws", { websocket: true }, (socket: WebSocket) => {
    const send = (m: ServerMessage) => socket.send(JSON.stringify(m));

    socket.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      void handle(msg, send, app.log);
    });
  });
});

async function handle(
  msg: ClientMessage,
  send: (m: ServerMessage) => void,
  log: typeof app.log,
) {
  if (msg.type === "close") return;
  const windowId = msg.windowId;

  // --- Launch: serve from App Cache instantly when possible. ---
  if (msg.type === "launch" && !msg.force) {
    const cached = appCache.get(msg.brief);
    if (cached) {
      appCache.markOpened(cached.key);
      send({
        type: "render",
        windowId,
        srcdoc: buildSrcDoc(cached.html),
        meta: { name: cached.name, glyph: cached.glyph, category: cached.category },
        sessionId: null, // session is established lazily on first interaction
        done: true,
      });
      send({ type: "status", windowId, state: "ready" });
      log.info({ windowId, key: cached.key }, "served from cache");
      return;
    }
  }

  // --- Build prompt for a live generation turn. ---
  let prompt: string;
  let resumeSessionId: string | undefined;
  if (msg.type === "launch") {
    prompt = buildLaunchPrompt(msg.brief);
  } else if (msg.sessionId) {
    prompt = buildEventPrompt(msg.action, msg.detail);
    resumeSessionId = msg.sessionId;
  } else {
    // Cache-opened window: no session yet — reconstruct from the brief.
    prompt = buildFirstEventPrompt(msg.brief, msg.action, msg.detail);
  }

  send({ type: "status", windowId, state: "thinking" });
  try {
    // Stream a throttled live preview of the UI as it generates.
    let acc = "";
    let lastFlush = 0;
    const onDelta = (chunk: string) => {
      acc += chunk;
      const now = Date.now();
      if (now - lastFlush < 180 || acc.length < 40) return;
      lastFlush = now;
      const html = sanitizePreview(acc);
      if (html.trim()) send({ type: "chunk", windowId, srcdoc: buildPreviewDoc(html) });
    };

    const { text, sessionId } = await runApp({ prompt, resumeSessionId, onDelta });
    const { html, meta } = sanitizeApp(text);
    if (!html.trim()) throw new Error("empty render");
    if (msg.type === "launch") appCache.put(msg.brief, html, meta);
    const srcdoc = buildSrcDoc(html);
    send({ type: "render", windowId, srcdoc, meta, sessionId, done: true });
    send({ type: "status", windowId, state: "ready" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, windowId }, "render failed");
    send({ type: "status", windowId, state: "error", message });
    send({ type: "error", windowId, message });
  }
}

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`VibeOs Agent Bridge listening on http://${HOST}:${PORT}`);
  app.log.info(`Using Claude binary: ${CLAUDE_BIN}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
