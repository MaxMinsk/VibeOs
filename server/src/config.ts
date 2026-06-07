// Agent Bridge configuration.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const HOST = process.env.HOST ?? "127.0.0.1"; // localhost-only by design
export const PORT = Number(process.env.PORT ?? 8787);

// Repo root (server/src -> ../../).
const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, "..", "..");
export const PROMPTS_DIR = resolve(ROOT, "prompts");
export const DESIGN_DIR = resolve(ROOT, "design-system");

/** Path to the local Claude Code binary (the SDK shells out to it). */
export const CLAUDE_BIN: string =
  process.env.CLAUDE_BIN ?? resolveClaudeBin();

function resolveClaudeBin(): string {
  try {
    return execSync("command -v claude", { encoding: "utf8" }).trim();
  } catch {
    return "claude"; // hope it's on PATH
  }
}

// Allowed origins for the shell dev server (Vite default + a fallback port).
export const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
];
