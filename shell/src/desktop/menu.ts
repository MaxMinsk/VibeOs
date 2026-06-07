// Reusable floating menu (used by the menu bar dropdowns and context menus).

export interface MenuItem {
  label?: string;
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface MenuOpts {
  /** Called whenever the menu closes (selection, outside click, Esc). */
  onClose?: () => void;
}

let closeCurrent: (() => void) | null = null;

export function closeMenus() {
  closeCurrent?.();
}

export function isMenuOpen(): boolean {
  return closeCurrent !== null;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** Open a menu at viewport coords (x, y). Returns a close() function. */
export function openMenu(
  items: MenuItem[],
  x: number,
  y: number,
  opts: MenuOpts = {},
): () => void {
  closeMenus();

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";

  const menu = document.createElement("div");
  menu.className = "os-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "os-menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const row = document.createElement("button");
    row.className = "os-menu-item";
    if (item.disabled) row.classList.add("disabled");
    row.innerHTML = `<span class="os-menu-label">${escapeHtml(item.label ?? "")}</span>${
      item.shortcut ? `<span class="os-menu-shortcut">${escapeHtml(item.shortcut)}</span>` : ""
    }`;
    if (!item.disabled && item.action) {
      row.addEventListener("click", () => {
        close();
        item.action!();
      });
    }
    menu.appendChild(row);
  }

  backdrop.appendChild(menu);
  document.body.appendChild(backdrop);

  // Keep the menu inside the viewport.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth - 6)
    menu.style.left = `${Math.max(6, window.innerWidth - r.width - 6)}px`;
  if (r.bottom > window.innerHeight - 6)
    menu.style.top = `${Math.max(6, window.innerHeight - r.height - 6)}px`;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    if (closeCurrent === close) closeCurrent = null;
    opts.onClose?.();
  };

  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  closeCurrent = close;
  return close;
}
