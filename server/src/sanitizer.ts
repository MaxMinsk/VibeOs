import sanitizeHtml from "sanitize-html";

export interface AppMeta {
  name?: string;
  glyph?: string;
  category?: string;
}

/** Remove ```html ... ``` style code fences the model may add. */
function stripFences(text: string): string {
  let t = text.trim();
  const fence = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/;
  const m = t.match(fence);
  if (m) t = m[1].trim();
  // Also strip stray leading/trailing fence lines.
  t = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "");
  return t.trim();
}

/** Pull out the trailing <!--vibe-meta {...}--> comment if present. */
export function extractMeta(html: string): { html: string; meta: AppMeta | null } {
  const re = /<!--\s*vibe-meta\s*([\s\S]*?)-->/i;
  const m = html.match(re);
  if (!m) return { html, meta: null };
  let meta: AppMeta | null = null;
  try {
    meta = JSON.parse(m[1].trim());
  } catch {
    meta = null;
  }
  return { html: html.replace(re, "").trim(), meta };
}

// Event-handler attributes the agent may use for local interactivity. Safe
// because the iframe sandbox (no same-origin, CSP default-src 'none') contains
// any script — it can only touch its own DOM, not the network or parent.
const EVENT_ATTRS = [
  "onclick", "ondblclick", "oninput", "onchange", "onsubmit", "onkeydown",
  "onkeyup", "onkeypress", "onmousedown", "onmouseup", "onmousemove",
  "onmouseenter", "onmouseleave", "onfocus", "onblur", "onwheel",
  "oncontextmenu", "ontouchstart", "ontouchend",
];

const SVG_ATTRS = [
  "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1",
  "x2", "y2", "points", "transform", "opacity", "offset", "stop-color",
  "gradientUnits", "preserveAspectRatio",
];

const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowVulnerableTags: true, // we intentionally allow <script>/<style> (sandboxed)
  allowedTags: [
    "div", "span", "p", "section", "header", "footer", "main", "nav", "aside",
    "article", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt",
    "dd", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
    "button", "input", "textarea", "select", "option", "optgroup", "label",
    "form", "fieldset", "legend", "a", "img", "br", "hr", "strong", "em", "b",
    "i", "u", "s", "small", "code", "pre", "blockquote", "figure", "figcaption",
    "progress", "meter", "datalist", "details", "summary",
    // Local interactivity & custom visuals (contained by the iframe sandbox):
    "script", "style", "canvas", "svg", "path", "g", "circle", "rect", "line",
    "polyline", "polygon", "ellipse", "text", "defs", "lineargradient",
    "radialgradient", "stop",
  ],
  allowedAttributes: {
    "*": [
      "class", "data-action", "data-arg", "data-*", "name", "value",
      "placeholder", "type", "checked", "selected", "disabled", "readonly",
      "multiple", "rows", "cols", "colspan", "rowspan", "for", "id", "title",
      "min", "max", "step", "style", "aria-label", "aria-selected", "aria-hidden",
      "role", "autofocus", "inputmode", "tabindex", "contenteditable",
      "autocomplete", "spellcheck", "width", "height", "list", "pattern",
      ...EVENT_ATTRS, ...SVG_ATTRS,
    ],
    // href is kept so the bridge can read the navigation target; actual network
    // navigation is blocked by the sandbox/CSP, the bridge intercepts the click.
    a: ["href", "data-action", "data-arg", "class", "title", "style", ...EVENT_ATTRS],
    img: ["src", "alt", "class", "width", "height", "style"],
    canvas: ["width", "height", "id", "class", "style"],
  },
  // No network of any kind: only data: images. (Scripts can't fetch under CSP.)
  // http(s) is allowed ONLY on <a href> so the bridge can read the target — the
  // sandbox/CSP still block any real navigation or request.
  allowedSchemes: [],
  allowedSchemesByTag: { img: ["data"], a: ["http", "https"] },
  allowProtocolRelative: false,
  // allowedStyles omitted → all inline styles pass (sandboxed; DS still encouraged).
  parser: { lowerCaseTags: false }, // preserve camelCase SVG tags/attrs
  disallowedTagsMode: "discard",
};

/** Clean raw model output into a safe HTML fragment + extracted metadata. */
export function sanitizeApp(raw: string): { html: string; meta: AppMeta | null } {
  const unfenced = stripFences(raw);
  const { html, meta } = extractMeta(unfenced);
  const clean = sanitizeHtml(html, SANITIZE_OPTS);
  return { html: clean, meta };
}

/**
 * Sanitize an INCOMPLETE stream for a live preview: cut at the first <script>
 * (no partial/active scripts mid-stream) and clean the visual HTML so far.
 */
export function sanitizePreview(raw: string): string {
  let t = stripFences(raw);
  const i = t.indexOf("<script");
  if (i >= 0) t = t.slice(0, i);
  return sanitizeHtml(t, SANITIZE_OPTS);
}
