// Registry of "applications" available in the dock.
// In VibeOs an app is not real code — launching it asks the agent to hallucinate
// its UI. The optional `brief` enriches what the agent generates by default.

export interface AppDef {
  id: string;
  name: string;
  /** Emoji/glyph shown on the icon tile. */
  glyph: string;
  /** CSS gradient for the icon tile background. */
  gradient: string;
  /** Rich brief sent to the agent (falls back to `name`). */
  brief?: string;
}

export const APPS: AppDef[] = [
  {
    id: "finder",
    name: "Finder",
    glyph: "🗂",
    gradient: "linear-gradient(160deg,#3aa0ff,#1f6fe0)",
    brief:
      "macOS Finder file browser: sidebar with Favorites (Desktop, Documents, Downloads, Applications) and iCloud, a main list/grid of believable files and folders with icons, sizes and modified dates, and a toolbar with view toggles and a search field. EVERY row must be clickable via data-action=\"open\" data-arg=\"<path>\": clicking a folder navigates into it (generate its contents); clicking a FILE opens a Quick Look preview of that file's contents (text, image, document, etc.) with a way back to the folder.",
  },
  {
    id: "notes",
    name: "Notes",
    glyph: "📝",
    gradient: "linear-gradient(160deg,#ffe07a,#ffb300)",
    brief:
      "macOS Notes app: sidebar list of notes with titles and previews, a main editor showing the selected note, a New button, and search. Keep a few realistic sample notes.",
  },
  {
    id: "calculator",
    name: "Calculator",
    glyph: "🧮",
    gradient: "linear-gradient(160deg,#5c5c5c,#1c1c1c)",
    brief:
      "macOS Calculator that actually works: a display and a grid of buttons (digits, + - * / =, clear, +/-, %, decimal). Implement the arithmetic in local JavaScript so it computes instantly.",
  },
  {
    id: "safari",
    name: "Safari",
    glyph: "🧭",
    gradient: "linear-gradient(160deg,#5ed0ff,#0a84ff)",
    brief:
      "Safari-style web browser: a toolbar with back/forward, a RELOAD button (data-action=\"reload\" data-arg=\"<current-url>\") to regenerate the current page, an address bar (an input with data-action=\"navigate\"), and a start page with favorites and a search field. Navigating to a URL or clicking a link renders that site; every link/post on a rendered page must be navigable.",
  },
  {
    id: "terminal",
    name: "Terminal",
    glyph: "⌘",
    gradient: "linear-gradient(160deg,#2b2b2b,#000000)",
    brief:
      "A working terminal with an interactive command line. Handle commands in local JavaScript (help, clear, echo, date, ls, whoami, pwd) with a realistic prompt and scrollback.",
  },
  {
    id: "settings",
    name: "Settings",
    glyph: "⚙️",
    gradient: "linear-gradient(160deg,#cfd4da,#8a9099)",
    brief:
      "macOS System Settings: a sidebar of categories (Wi-Fi, Bluetooth, Network, Displays, Sound, Battery, General) and a detail pane with realistic toggles, sliders and fields for the selected category. Wire toggles/sliders with local JavaScript.",
  },
];
