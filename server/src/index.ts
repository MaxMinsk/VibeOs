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
  buildRegionPrompt,
  buildRegionNavPrompt,
} from "./prompt-builder.js";
import {
  sanitizeApp,
  sanitizePreview,
  extractFsOps,
  extractProfile,
  extractLayout,
  type AppMeta,
} from "./sanitizer.js";
import { buildSrcDoc, buildPreviewDoc } from "./wrapper.js";
import { appCache, type LayoutManifest } from "./app-cache.js";
import { pageCache, pageKey } from "./page-cache.js";
import { vfs, type FsOp } from "./vfs.js";

/** The app's declared region structure, injected so the agent keeps it stable. */
function layoutBlock(brief: string): string {
  const l = appCache.getLayout(brief);
  return l
    ? "\n\nAPP LAYOUT (this app's regions — STATIC regions are the shell and must " +
        "NOT be regenerated; update only the relevant dynamic region; keep these " +
        "exact region ids):\n" + JSON.stringify(l.regions)
    : "";
}

/** The default dynamic content region of an app, if it declared one. */
function defaultRegion(layout: LayoutManifest | undefined): string {
  if (!layout) return "";
  const r =
    layout.regions.find((x) => x.default && !x.static) ??
    layout.regions.find((x) => x.role === "content" && !x.static) ??
    layout.regions.find((x) => x.dynamic && !x.static);
  return r?.id ?? "";
}

/** The app's evolving design/state digest, injected to keep it consistent. */
function profileBlock(brief: string): string {
  const p = appCache.getProfile(brief);
  return p
    ? "\n\nAPP PROFILE (a compact evolving summary of THIS app — keep its look, " +
        "structure, naming and behaviour consistent with it):\n" + p
    : "";
}

/** Filesystem context appended to generation prompts. */
function fsBlock(): string {
  return (
    "\n\nVIRTUAL FILESYSTEM (the OS's shared files — render file managers/pickers " +
    'from THIS list, open a path via data-action="open" data-arg="<path>"; to ' +
    "create/edit/delete files emit a trailing <!--vibe-fs [...]--> as documented):\n" +
    vfs.listing()
  );
}
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
  brief: string,
  prompt: string,
  resumeSessionId: string | undefined,
  send: Send,
  log: typeof app.log,
  patchMode = false,
): Promise<{
  html: string;
  meta: ReturnType<typeof sanitizeApp>["meta"];
  sessionId: string | null;
  profile: string | null;
  layout: LayoutManifest | null;
} | null> {
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
      prompt: prompt + layoutBlock(brief) + profileBlock(brief) + fsBlock(),
      resumeSessionId,
      model,
      onDelta,
    });
    // Apply any filesystem operations the agent emitted.
    const ops = extractFsOps(text) as FsOp[];
    if (ops.length && vfs.apply(ops)) pageCache.clear();
    const profile = extractProfile(text);
    const layout = extractLayout(text) as LayoutManifest | null;
    const { html, meta } = sanitizeApp(text);
    if (!html.trim()) throw new Error("empty render");
    if (patchMode) send({ type: "patch", windowId, html });
    else send({ type: "render", windowId, srcdoc: buildSrcDoc(html), meta, sessionId, done: true });
    send({ type: "status", windowId, state: "ready" });
    log.info({ windowId, patchMode, cacheReadTokens }, "rendered");
    return { html, meta, sessionId, profile, layout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, windowId }, "render failed");
    send({ type: "status", windowId, state: "error", message });
    send({ type: "error", windowId, message });
    return null;
  }
}

/** Generate just one named region of an app (Tier-2 targeted update). */
async function runRegion(
  windowId: string,
  brief: string,
  target: string,
  prompt: string,
  send: Send,
  log: typeof app.log,
  model: string = MODEL_PATCH,
  cacheKey?: string,
) {
  send({ type: "status", windowId, state: "thinking" });
  try {
    const { text } = await runApp({
      prompt: prompt + layoutBlock(brief) + profileBlock(brief) + fsBlock(),
      model,
    });
    const { html } = sanitizeApp(text);
    if (!html.trim()) throw new Error("empty region");
    if (cacheKey) pageCache.put(cacheKey, html);
    send({ type: "patch-region", windowId, target, html });
    send({ type: "status", windowId, state: "ready" });
    log.info({ windowId, target }, "region patched");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, windowId, target }, "region failed");
    send({ type: "status", windowId, state: "error", message });
    send({ type: "error", windowId, message });
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
    } else {
      // Regenerating the whole app (⌘J) invalidates all of its inner pages.
      pageCache.clearByBrief(msg.brief);
    }
    const res = await runAndRender(windowId, msg.brief, buildLaunchPrompt(msg.brief), undefined, send, log);
    if (res) {
      appCache.put(msg.brief, res.html, res.meta);
      if (res.profile) appCache.setProfile(msg.brief, res.profile);
      if (res.layout) appCache.setLayout(msg.brief, res.layout);
    }
    return;
  }

  // --- Recovery: force a full re-render (e.g. after a region miss). ---
  if (msg.type === "event" && msg.forceFull) {
    const prompt = msg.sessionId
      ? buildEventPrompt(msg.action, msg.detail)
      : buildFirstEventPrompt(msg.brief, msg.action, msg.detail);
    const res = await runAndRender(windowId, msg.brief, prompt, msg.sessionId ?? undefined, send, log);
    if (res) {
      if (res.profile) appCache.setProfile(msg.brief, res.profile);
      if (res.layout) appCache.setLayout(msg.brief, res.layout);
    }
    return;
  }

  // --- Resolve region + arg from the event. ---
  const d = (msg.detail ?? {}) as { target?: unknown; regionHtml?: unknown; arg?: unknown };
  const explicitTarget = typeof d.target === "string" ? d.target : "";
  const regionHtml = typeof d.regionHtml === "string" ? d.regionHtml : "";
  const arg = d.arg != null ? String(d.arg) : "";
  const isDrill = DRILL_ACTIONS.has(msg.action);

  // --- Region NAVIGATION: drill into a region (cacheable, destination-based). ---
  if (isDrill && arg) {
    const region = explicitTarget || defaultRegion(appCache.getLayout(msg.brief));
    if (region) {
      const rkey = pageKey(msg.brief, region + "::" + arg);
      if (msg.action !== "reload") {
        const cached = pageCache.get(rkey);
        if (cached) {
          send({ type: "patch-region", windowId, target: region, html: cached });
          send({ type: "status", windowId, state: "ready" });
          log.info({ windowId, rkey }, "region cache hit");
          return;
        }
      }
      const act = msg.action === "reload" ? "navigate" : msg.action;
      let rprompt = buildRegionNavPrompt(msg.brief, act, arg, region);
      const fc = vfs.read(arg);
      if (fc !== undefined) rprompt += `\n\nCONTENTS of ${arg}:\n${fc}`;
      await runRegion(windowId, msg.brief, region, rprompt, send, log, MODEL_PATCH, rkey);
      return;
    }

    // No declared region → full drill-in render (whole body, page cache).
    const key = pageKey(msg.brief, arg);
    if (msg.action !== "reload") {
      const cachedHtml = pageCache.get(key);
      if (cachedHtml) {
        serveCached(windowId, cachedHtml, null, msg.sessionId, send);
        log.info({ windowId, key }, "page cache hit");
        return;
      }
    }
    const action = msg.action === "reload" ? "navigate" : msg.action;
    let prompt = msg.sessionId
      ? buildEventPrompt(action, { ...(msg.detail as object), arg })
      : buildFirstEventPrompt(msg.brief, action, { ...(msg.detail as object), arg });
    const fileContent = vfs.read(arg);
    if (fileContent !== undefined)
      prompt += `\n\nCONTENTS of ${arg}:\n${fileContent}`;
    const res = await runAndRender(windowId, msg.brief, prompt, msg.sessionId ?? undefined, send, log);
    if (res) {
      pageCache.put(key, res.html);
      if (res.profile) appCache.setProfile(msg.brief, res.profile);
      if (res.layout) appCache.setLayout(msg.brief, res.layout);
    }
    return;
  }

  // --- Region IN-PLACE edit (data-target, not a navigation): no cache. ---
  if (explicitTarget && regionHtml) {
    const prompt = buildRegionPrompt(msg.brief, msg.action, arg, explicitTarget, regionHtml);
    await runRegion(windowId, msg.brief, explicitTarget, prompt, send, log, MODEL_PATCH);
    return;
  }

  // --- Generic in-place event: patch the whole body (preserve focus/scroll). ---
  const prompt = msg.sessionId
    ? buildEventPrompt(msg.action, msg.detail)
    : buildFirstEventPrompt(msg.brief, msg.action, msg.detail);
  const res = await runAndRender(windowId, msg.brief, prompt, msg.sessionId ?? undefined, send, log, true);
  if (res?.profile) appCache.setProfile(msg.brief, res.profile);
  if (res?.layout) appCache.setLayout(msg.brief, res.layout);
}

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`VibeOs Agent Bridge listening on http://${HOST}:${PORT}`);
  app.log.info(`Using Claude binary: ${CLAUDE_BIN}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
