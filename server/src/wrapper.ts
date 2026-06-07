import { resolve } from "node:path";
import { DESIGN_DIR } from "./config.js";
import { freshFile } from "./fs-cache.js";

const TEMPLATE = resolve(DESIGN_DIR, "wrapper.html");
const CSS = resolve(DESIGN_DIR, "design-system.css");
const BRIDGE = resolve(DESIGN_DIR, "bridge.js");

// Use split/join (not String.replace) so `$` in CSS/JS isn't treated specially.
function fill(tpl: string, key: string, value: string): string {
  return tpl.split(key).join(value);
}

/** Build the full iframe srcdoc document from a sanitized app-body fragment. */
export function buildSrcDoc(bodyHtml: string): string {
  // Read fresh (mtime-cached) so DS/bridge edits apply without a restart.
  let out = fill(freshFile(TEMPLATE), "{{STYLE}}", freshFile(CSS));
  out = fill(out, "{{CONTENT}}", bodyHtml);
  out = fill(out, "{{BRIDGE}}", freshFile(BRIDGE));
  return out;
}

/** Like buildSrcDoc but without the bridge — for streaming previews (no JS). */
export function buildPreviewDoc(bodyHtml: string): string {
  let out = fill(freshFile(TEMPLATE), "{{STYLE}}", freshFile(CSS));
  out = fill(out, "{{CONTENT}}", bodyHtml);
  out = fill(out, "{{BRIDGE}}", "");
  return out;
}
