import { resolve } from "node:path";
import { PROMPTS_DIR, DESIGN_DIR } from "./config.js";
import { freshFile } from "./fs-cache.js";

// System prompt = base rules + Design System contract. Read fresh (mtime-cached)
// so edits to the prompt / DS apply without a server restart.
export function getSystemPrompt(): string {
  const baseRules = freshFile(resolve(PROMPTS_DIR, "system.md"));
  const dsContract = freshFile(resolve(DESIGN_DIR, "ds-prompt.md"));
  return `${baseRules}\n\n---\n\n${dsContract}`;
}

/** Prompt for the very first render of an app, from a free-text brief. */
export function buildLaunchPrompt(brief: string): string {
  return [
    "Generate the initial UI for this app. Honor the brief's type, content and",
    "personality. Remember to end with the <!--vibe-meta ...--> comment.",
    "",
    `BRIEF: ${brief}`,
  ].join("\n");
}

/** Prompt for a follow-up user action inside an already-open app (M4). */
export function buildEventPrompt(action: string, detail: unknown): string {
  return [
    "The user interacted with the app. Update and return the full app UI body to",
    "reflect this action, keeping prior state coherent. Do NOT include vibe-meta.",
    "",
    `ACTION: ${action}`,
    `DETAIL: ${JSON.stringify(detail)}`,
  ].join("\n");
}

/**
 * Update only ONE named region of an app (Tier-2 targeted update). The agent gets
 * the region's current HTML and returns just its new inner HTML.
 */
export function buildRegionPrompt(
  brief: string,
  action: string,
  arg: unknown,
  target: string,
  regionHtml: string,
): string {
  return [
    `Update ONLY the region "#${target}" of this app after a user action. Return`,
    `ONLY the new INNER HTML of #${target} — no wrapping element, no other parts of`,
    "the app, no <!--vibe-* --> trailers. Keep it consistent with the app's look",
    "(see APP PROFILE) and the Design System.",
    "",
    `APP: ${brief}`,
    `ACTION: ${action}`,
    `ARG: ${JSON.stringify(arg)}`,
    "",
    `CURRENT INNER HTML of #${target}:`,
    regionHtml,
  ].join("\n");
}

/**
 * Navigate inside an app with a stable shell — regenerate ONLY the default content
 * region (Tier 3a). The static shell (sidebar/toolbar/menubar) stays untouched.
 */
export function buildRegionNavPrompt(
  brief: string,
  action: string,
  arg: unknown,
  regionId: string,
): string {
  return [
    `The user navigated inside this app. Regenerate ONLY the content region`,
    `"#${regionId}" for this destination — the app's static shell (sidebar,`,
    `toolbar, menu bar) stays exactly as it is, do NOT re-emit it.`,
    `Return ONLY the new INNER HTML of #${regionId} — no wrapping element, no other`,
    `regions, no <!--vibe-* --> trailers. Match the APP LAYOUT and APP PROFILE.`,
    "",
    `APP: ${brief}`,
    `ACTION: ${action}`,
    `DESTINATION: ${JSON.stringify(arg)}`,
  ].join("\n");
}

/**
 * First interaction on a window that was opened from cache (no live session yet).
 * Re-establishes context from the brief so the new session can continue.
 */
export function buildFirstEventPrompt(
  brief: string,
  action: string,
  detail: unknown,
): string {
  return [
    "Continue this app after a user action. First reconstruct the app from its",
    "brief, then apply the action and return the full updated UI body.",
    "Do NOT include vibe-meta.",
    "",
    `BRIEF: ${brief}`,
    `ACTION: ${action}`,
    `DETAIL: ${JSON.stringify(detail)}`,
  ].join("\n");
}
