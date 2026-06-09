import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";
import type { AppMeta } from "./sanitizer.js";

export interface LayoutRegion {
  id: string;
  role?: string;
  static?: boolean;
  dynamic?: boolean;
  default?: boolean;
}
export interface LayoutManifest {
  regions: LayoutRegion[];
}

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
  /** Compact evolving design/state digest, injected to keep the app consistent. */
  profile?: string;
  /** Declared region structure (shell + dynamic regions) — Tier 3. */
  layout?: LayoutManifest;
  createdAt: string;
  lastOpened: string;
  opens: number;
}

const CACHE_DIR = resolve(ROOT, "server", ".cache");
const CACHE_FILE = resolve(CACHE_DIR, "apps.json");

export function normalizeBrief(brief: string): string {
  return brief.trim().toLowerCase().replace(/\s+/g, " ");
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

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
    this.dedupeByName(); // clean up any historical duplicates on startup
  }

  get(brief: string): CachedApp | undefined {
    return this.map.get(normalizeBrief(brief));
  }

  /** Store a fresh first render. Overwrites the same brief and collapses any
   *  other entry sharing the same display name (so one app == one Launchpad icon).
   */
  put(brief: string, html: string, meta: AppMeta | null): CachedApp {
    const key = normalizeBrief(brief);
    const now = new Date().toISOString();
    const prev = this.map.get(key);
    const entry: CachedApp = {
      key,
      brief,
      name: meta?.name || prev?.name || brief,
      glyph: meta?.glyph || prev?.glyph || "✦",
      category: meta?.category || prev?.category || "utility",
      html,
      createdAt: prev?.createdAt || now,
      lastOpened: now,
      opens: prev?.opens ?? 1,
    };
    this.map.set(key, entry);
    // Drop other entries with the same name (older variants / duplicates).
    const n = normalizeName(entry.name);
    for (const [k, e] of this.map) {
      if (k !== key && normalizeName(e.name) === n) this.map.delete(k);
    }
    this.persist();
    return entry;
  }

  remove(key: string): boolean {
    const ok = this.map.delete(key);
    if (ok) this.persist();
    return ok;
  }

  getProfile(brief: string): string | undefined {
    return this.map.get(normalizeBrief(brief))?.profile;
  }

  getLayout(brief: string): LayoutManifest | undefined {
    return this.map.get(normalizeBrief(brief))?.layout;
  }

  setLayout(brief: string, layout: LayoutManifest) {
    const e = this.map.get(normalizeBrief(brief));
    if (!e) return;
    e.layout = layout;
    this.persist();
  }

  /** Update an app's profile digest (no-op if the app isn't cached yet). */
  setProfile(brief: string, profile: string) {
    const e = this.map.get(normalizeBrief(brief));
    if (!e || e.profile === profile) return;
    e.profile = profile;
    this.persist();
  }

  markOpened(key: string) {
    const e = this.map.get(key);
    if (!e) return;
    e.opens++;
    e.lastOpened = new Date().toISOString();
    this.persist();
  }

  /** Keep only the most-recently-opened entry per display name. */
  private dedupeByName() {
    const byName = new Map<string, CachedApp>();
    for (const e of this.map.values()) {
      const n = normalizeName(e.name);
      const cur = byName.get(n);
      if (!cur || e.lastOpened > cur.lastOpened) byName.set(n, e);
    }
    if (byName.size === this.map.size) return; // nothing to do
    this.map = new Map([...byName.values()].map((e) => [e.key, e]));
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
