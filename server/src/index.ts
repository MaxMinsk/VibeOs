import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { HOST, PORT, ALLOWED_ORIGINS, CLAUDE_BIN, MODEL_PATCH, MODEL_FULL } from "./config.js";
import { runApp } from "./claude-runner.js";
import {
  buildLaunchPrompt,
  buildEventPrompt,
  buildFirstEventPrompt,
} from "./prompt-builder.js";
import { sanitizeApp, sanitizePreview, type AppMeta } from "./sanitizer.js";
import { buildSrcDoc, buildPreviewDoc } from "./wrapper.js";
import { appCache } from "./app-cache.js";
import { pageCache, pageKey } from "./page-cache.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";

// Event actions that are read-only "drill-ins" worth caching by target
// (browser pages, Finder folders/files). `reload` force-regenerates.
const DRILL_ACTIONS = new Set(["navigate", "open", "reload"]);

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

type Send = (m: ServerMessage) => void;

/** Send an already-rendered (cached) screen instantly. */
function serveCached(
  windowId: string,
  html: string,
  meta: AppMeta | null,
  sessionId: string | null,
  send: Send,
) {
  send({ type: "render", windowId, srcdoc: buildSrcDoc(html), meta, sessionId, done: true });
  send({ type: "status", windowId, state: "ready" });
}

/** Generate a screen with live streaming and send it. Returns the result. */
async function runAndRender(
  windowId: string,
  prompt: string,
  resumeSessionId: string | undefined,
  send: Send,
  log: typeof app.log,
  patchMode = false,
): Promise<{ html: string; meta: ReturnType<typeof sanitizeApp>["meta"]; sessionId: string | null } | null> {
  send({ type: "status", windowId, state: "thinking" });
  try {
    // Stream a live preview only for full renders (a patch updates in place).
    let acc = "";
    let lastFlush = 0;
    const onDelta = patchMode
      ? undefined
      : (chunk: string) => {
          acc += chunk;
          const now = Date.now();
          if (now - lastFlush < 180 || acc.length < 40) return;
          lastFlush = now;
          const preview = sanitizePreview(acc);
          if (preview.trim())
            send({ type: "chunk", windowId, srcdoc: buildPreviewDoc(preview) });
        };

    const model = patchMode ? MODEL_PATCH : MODEL_FULL;
    const { text, sessionId, cacheReadTokens } = await runApp({
      prompt,
      resumeSessionId,
      model,
      onDelta,
    });
    const { html, meta } = sanitizeApp(text);
    if (!html.trim()) throw new Error("empty render");
    if (patchMode) send({ type: "patch", windowId, html });
    else send({ type: "render", windowId, srcdoc: buildSrcDoc(html), meta, sessionId, done: true });
    send({ type: "status", windowId, state: "ready" });
    log.info({ windowId, patchMode, cacheReadTokens }, "rendered");
    return { html, meta, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, windowId }, "render failed");
    send({ type: "status", windowId, state: "error", message });
    send({ type: "error", windowId, message });
    return null;
  }
}

async function handle(msg: ClientMessage, send: Send, log: typeof app.log) {
  if (msg.type === "close") return;
  const windowId = msg.windowId;

  // --- Launch: serve from App Cache, else generate and cache. ---
  if (msg.type === "launch") {
    if (!msg.force) {
      const cached = appCache.get(msg.brief);
      if (cached) {
        appCache.markOpened(cached.key);
        serveCached(
          windowId,
          cached.html,
          { name: cached.name, glyph: cached.glyph, category: cached.category },
          null,
          send,
        );
        log.info({ windowId, key: cached.key }, "app cache hit");
        return;
      }
    }
    const res = await runAndRender(windowId, buildLaunchPrompt(msg.brief), undefined, send, log);
    if (res) appCache.put(msg.brief, res.html, res.meta);
    return;
  }

  // --- Drill-in events (browser pages, Finder folders/files): page cache. ---
  const arg = msg.detail && typeof msg.detail === "object"
    ? String((msg.detail as { arg?: unknown }).arg ?? "")
    : "";
  if (DRILL_ACTIONS.has(msg.action) && arg) {
    const key = pageKey(msg.brief, arg);
    const force = msg.action === "reload";
    if (!force) {
      const cachedHtml = pageCache.get(key);
      if (cachedHtml) {
        serveCached(windowId, cachedHtml, null, msg.sessionId, send);
        log.info({ windowId, key }, "page cache hit");
        return;
      }
    }
    // reload → re-render the same target as a navigation.
    const action = msg.action === "reload" ? "navigate" : msg.action;
    const prompt = msg.sessionId
      ? buildEventPrompt(action, { ...(msg.detail as object), arg })
      : buildFirstEventPrompt(msg.brief, action, { ...(msg.detail as object), arg });
    const res = await runAndRender(windowId, prompt, msg.sessionId ?? undefined, send, log);
    if (res) pageCache.put(key, res.html);
    return;
  }

  // --- Generic in-place event: patch the DOM (preserve focus/scroll). ---
  const prompt = msg.sessionId
    ? buildEventPrompt(msg.action, msg.detail)
    : buildFirstEventPrompt(msg.brief, msg.action, msg.detail);
  await runAndRender(windowId, prompt, msg.sessionId ?? undefined, send, log, true);
}

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`VibeOs Agent Bridge listening on http://${HOST}:${PORT}`);
  app.log.info(`Using Claude binary: ${CLAUDE_BIN}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
