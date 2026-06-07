import { readFileSync, statSync } from "node:fs";

interface Entry {
  mtimeMs: number;
  content: string;
}

const cache = new Map<string, Entry>();

/**
 * Read a file, re-reading only when its mtime changes. Lets us pick up edits to
 * prompts / Design System assets without restarting the server, while avoiding a
 * disk read on every call.
 */
export function freshFile(path: string): string {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.content;
  const content = readFileSync(path, "utf8");
  cache.set(path, { mtimeMs, content });
  return content;
}
