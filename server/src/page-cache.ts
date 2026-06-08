import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";
import { normalizeBrief } from "./app-cache.js";

// Caches the result of in-app drill-ins (Safari pages, Finder folders/files),
// keyed by app brief + target. Separate from the App Cache so visited pages do
// NOT show up in Launchpad/Spotlight.

const CACHE_DIR = resolve(ROOT, "server", ".cache");
const CACHE_FILE = resolve(CACHE_DIR, "pages.json");

export function pageKey(brief: string, target: string): string {
  return `${normalizeBrief(brief)}::${target.trim().toLowerCase()}`;
}

class PageCache {
  private map = new Map<string, string>();

  constructor() {
    if (existsSync(CACHE_FILE)) {
      try {
        const obj = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, string>;
        for (const [k, v] of Object.entries(obj)) this.map.set(k, v);
      } catch {
        /* ignore corrupt cache */
      }
    }
  }

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  put(key: string, html: string) {
    this.map.set(key, html);
    this.persist();
  }

  /** Drop all cached pages (e.g. after the filesystem changes). */
  clear() {
    if (this.map.size === 0) return;
    this.map.clear();
    this.persist();
  }

  /** Drop all pages of one app — used when the whole app is regenerated (⌘J). */
  clearByBrief(brief: string) {
    const prefix = normalizeBrief(brief) + "::";
    let changed = false;
    for (const k of [...this.map.keys()])
      if (k.startsWith(prefix)) {
        this.map.delete(k);
        changed = true;
      }
    if (changed) this.persist();
  }

  private persist() {
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(this.map), null, 2));
    } catch {
      /* best-effort */
    }
  }
}

export const pageCache = new PageCache();
