import { SERVER_URL } from "../config";
import { APPS } from "../apps";

export interface CachedAppInfo {
  key: string;
  brief: string;
  name: string;
  glyph: string;
  category: string;
  opens: number;
  lastOpened: string;
}

export interface AppEntry {
  /** Brief used to launch (cache key source). */
  brief: string;
  name: string;
  glyph: string;
  source: "builtin" | "cached";
  category?: string;
  /** Recency for cached apps (sorting). */
  lastOpened?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export async function fetchCachedApps(): Promise<CachedAppInfo[]> {
  try {
    const res = await fetch(`${SERVER_URL}/apps`, { cache: "no-store" });
    if (!res.ok) return [];
    return (await res.json()) as CachedAppInfo[];
  } catch {
    return [];
  }
}

/** Merge built-in dock apps with cached apps (cached preferred on key clash). */
export async function getAllApps(): Promise<AppEntry[]> {
  const cached = await fetchCachedApps();
  const byKey = new Map<string, AppEntry>();

  for (const a of APPS) {
    byKey.set(norm(a.name), {
      brief: a.name,
      name: a.name,
      glyph: a.glyph,
      source: "builtin",
    });
  }
  for (const c of cached) {
    byKey.set(c.key, {
      brief: c.brief,
      name: c.name,
      glyph: c.glyph,
      source: "cached",
      category: c.category,
      lastOpened: c.lastOpened,
    });
  }
  return [...byKey.values()];
}

/** Score an entry against a query: higher = better; -1 = no match. */
export function scoreEntry(entry: AppEntry, query: string): number {
  const q = norm(query);
  if (!q) return entry.source === "cached" ? 1 : 0; // empty: show all, cached first
  const name = norm(entry.name);
  const brief = norm(entry.brief);
  if (name === q || brief === q) return 100;
  if (name.startsWith(q) || brief.startsWith(q)) return 70;
  if (name.includes(q) || brief.includes(q)) return 40;
  if (fuzzy(name, q) || fuzzy(brief, q)) return 20;
  return -1;
}

/** Subsequence fuzzy match (chars of q appear in order in s). */
function fuzzy(s: string, q: string): boolean {
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
}
