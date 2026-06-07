import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";
import type { AppMeta } from "./sanitizer.js";

export interface CachedApp {
  /** Normalized brief = cache key. */
  key: string;
  /** Original brief text. */
  brief: string;
  name: string;
  glyph: string;
  category: string;
  /** Sanitized first-render HTML body (srcdoc is rebuilt on serve). */
  html: string;
  createdAt: string;
  lastOpened: string;
  opens: number;
}

const CACHE_DIR = resolve(ROOT, "server", ".cache");
const CACHE_FILE = resolve(CACHE_DIR, "apps.json");

export function normalizeBrief(brief: string): string {
  return brief.trim().toLowerCase().replace(/\s+/g, " ");
}

class AppCache {
  private map = new Map<string, CachedApp>();

  constructor() {
    if (existsSync(CACHE_FILE)) {
      try {
        const arr: CachedApp[] = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
        for (const a of arr) this.map.set(a.key, a);
      } catch {
        /* ignore corrupt cache */
      }
    }
  }

  get(brief: string): CachedApp | undefined {
    return this.map.get(normalizeBrief(brief));
  }

  /** Store a fresh first render. */
  put(brief: string, html: string, meta: AppMeta | null): CachedApp {
    const key = normalizeBrief(brief);
    const now = new Date().toISOString();
    const entry: CachedApp = {
      key,
      brief,
      name: meta?.name || brief,
      glyph: meta?.glyph || "✦",
      category: meta?.category || "utility",
      html,
      createdAt: now,
      lastOpened: now,
      opens: 1,
    };
    this.map.set(key, entry);
    this.persist();
    return entry;
  }

  markOpened(key: string) {
    const e = this.map.get(key);
    if (!e) return;
    e.opens++;
    e.lastOpened = new Date().toISOString();
    this.persist();
  }

  list(): CachedApp[] {
    return [...this.map.values()].sort((a, b) =>
      b.lastOpened.localeCompare(a.lastOpened),
    );
  }

  private persist() {
    try {
      if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify([...this.map.values()], null, 2));
    } catch {
      /* best-effort */
    }
  }
}

export const appCache = new AppCache();
