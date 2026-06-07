import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT } from "./config.js";

// A tiny virtual filesystem shared by all generated apps, so "saving" in one app
// shows up in Finder, etc. The agent reads it from the prompt and writes to it by
// emitting a <!--vibe-fs [...]--> trailer.

export interface VfsEntry {
  path: string;
  name: string;
  kind: "folder" | "file";
  content?: string;
  size: number;
  modified: string;
}

export interface FsOp {
  op: "write" | "delete" | "mkdir";
  path: string;
  content?: string;
}

const STORE = resolve(ROOT, "server", ".cache", "vfs.json");
const HOME = "/Users/maxim";

const SEED: Array<[string, "folder" | "file", string?]> = [
  [HOME, "folder"],
  [`${HOME}/Desktop`, "folder"],
  [`${HOME}/Documents`, "folder"],
  [`${HOME}/Documents/todo.txt`, "file", "1. Ship VibeOs\n2. Touch grass\n3. Profit"],
  [`${HOME}/Documents/budget.csv`, "file", "month,spend\nApr,1200\nMay,980"],
  [`${HOME}/Documents/ideas.md`, "file", "# Ideas\n- An OS that hallucinates apps\n- ..."],
  [`${HOME}/Downloads`, "folder"],
  [`${HOME}/Downloads/vibeos-0.1.dmg`, "file", "(binary)"],
  [`${HOME}/Pictures`, "folder"],
  [`${HOME}/Pictures/sunset.png`, "file", "(image data)"],
  [`${HOME}/Music`, "folder"],
];

const baseName = (p: string) => p.split("/").filter(Boolean).pop() || p;

class Vfs {
  private map = new Map<string, VfsEntry>();

  constructor() {
    if (existsSync(STORE)) {
      try {
        const arr: VfsEntry[] = JSON.parse(readFileSync(STORE, "utf8"));
        for (const e of arr) this.map.set(e.path, e);
      } catch {
        /* fall through to seed */
      }
    }
    if (this.map.size === 0) {
      for (const [path, kind, content] of SEED)
        this.set(path, kind, content, "2026-06-01T12:00:00Z");
      this.persist();
    }
  }

  private set(path: string, kind: "folder" | "file", content?: string, modified?: string) {
    this.map.set(path, {
      path,
      name: baseName(path),
      kind,
      content: kind === "file" ? (content ?? "") : undefined,
      size: kind === "file" ? (content ?? "").length : 0,
      modified: modified ?? new Date().toISOString(),
    });
  }

  read(path: string): string | undefined {
    const e = this.map.get(path);
    return e && e.kind === "file" ? (e.content ?? "") : undefined;
  }

  apply(ops: FsOp[]): boolean {
    let changed = false;
    for (const op of ops) {
      if (!op || !op.path) continue;
      if (op.op === "delete") {
        // delete the path and anything beneath it
        for (const k of [...this.map.keys()])
          if (k === op.path || k.startsWith(op.path + "/")) {
            this.map.delete(k);
            changed = true;
          }
      } else if (op.op === "mkdir") {
        this.ensureParents(op.path);
        if (!this.map.has(op.path)) {
          this.set(op.path, "folder");
          changed = true;
        }
      } else if (op.op === "write") {
        this.ensureParents(op.path);
        this.set(op.path, "file", op.content ?? "");
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  private ensureParents(path: string) {
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur += "/" + parts[i];
      if (!this.map.has(cur)) this.set(cur, "folder");
    }
  }

  /** Compact listing for the prompt (paths + kind + size; no file contents). */
  listing(): string {
    return [...this.map.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((e) =>
        e.kind === "folder"
          ? `${e.path}/  (folder)`
          : `${e.path}  (file, ${e.size}B, ${e.modified.slice(0, 10)})`,
      )
      .join("\n");
  }

  private persist() {
    try {
      const dir = resolve(ROOT, "server", ".cache");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(STORE, JSON.stringify([...this.map.values()], null, 2));
    } catch {
      /* best-effort */
    }
  }
}

export const vfs = new Vfs();
