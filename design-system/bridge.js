/* VibeOs iframe bridge — injected into every app window.
   Captures user interactions and reports them to the shell via postMessage.
   The window's id is carried in window.name (set by the shell on the iframe). */
(function () {
  "use strict";

  var WINDOW_ID = window.name || "";

  // Collect values of all named form controls (the app's editable state).
  function collectFormState() {
    var state = {};
    var nodes = document.querySelectorAll("[name]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute("name");
      if (!name) continue;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked) state[name] = el.value;
      } else {
        state[name] = el.value;
      }
    }
    return state;
  }

  function send(action, arg, target) {
    // If a region is targeted, include its current HTML so the agent can update
    // only that region (the rest of the app stays as-is).
    var regionHtml = null;
    if (target) {
      var region = document.getElementById(target);
      if (region) {
        regionHtml = region.innerHTML;
        // Local busy indicator on the region's own window (not the whole OS).
        var bw = region.closest("[data-window]") || region;
        bw.classList.add("vibe-busy");
        clearTimeout(bw._vibeBusyT);
        bw._vibeBusyT = setTimeout(function () {
          bw.classList.remove("vibe-busy");
        }, 120000);
      }
    }
    parent.postMessage(
      {
        type: "vibe-event",
        windowId: WINDOW_ID,
        event: {
          action: action,
          arg: arg == null ? null : arg,
          target: target || null,
          regionHtml: regionHtml,
          formState: collectFormState(),
        },
      },
      "*",
    );
  }

  // Click handling. Clicking INTO a text field never triggers an action — fields
  // are edited and submitted via Enter / a button / change (below). This keeps
  // address bars and search boxes stable.
  var CLICKABLE =
    "button, [role=button], .vibe-btn, .vibe-list-row, .vibe-sidebar-item," +
    " .vibe-tab, .vibe-menu-item, .vibe-tile, .vibe-segmented > button";

  function label(el) {
    return (el.getAttribute("aria-label") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }

  // ---- Popover menus (open instantly, no regeneration) -------------------
  var openMenu = null;
  function closeMenu() {
    if (openMenu) {
      openMenu.classList.remove("open");
      openMenu = null;
    }
  }
  function esc(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id;
  }
  function toggleMenu(trigger) {
    var id = trigger.getAttribute("data-menu");
    var menu = document.querySelector('[data-menu-content="' + esc(id) + '"]');
    if (!menu) return;
    if (openMenu === menu) {
      closeMenu();
      return;
    }
    closeMenu();
    menu.classList.add("open");
    var r = trigger.getBoundingClientRect();
    var mw = menu.offsetWidth,
      mh = menu.offsetHeight;
    var left = r.left,
      top = r.bottom + 4;
    if (left + mw > window.innerWidth - 6) left = window.innerWidth - mw - 6;
    if (top + mh > window.innerHeight - 6) top = r.top - mh - 4;
    menu.style.left = Math.max(6, left) + "px";
    menu.style.top = Math.max(6, top) + "px";
    openMenu = menu;
  }

  // ---- Nested window runtime ---------------------------------------------
  // Any generated element marked [data-window] becomes a real window: focus by
  // z-index, drag via [data-drag-handle], resize via [data-resize], and
  // close/min/max via [data-window-action] — all locally, no agent call. This is
  // what makes an app (e.g. a Windows-98 desktop) host its own working windows.
  var winZ = 1000;
  function nearestWindow(el) {
    return el && el.closest ? el.closest("[data-window]") : null;
  }
  function raiseWindow(win) {
    if (win) win.style.zIndex = String(++winZ);
  }

  // Focus (raise) on pointerdown anywhere inside a window.
  document.addEventListener(
    "pointerdown",
    function (e) {
      raiseWindow(nearestWindow(e.target));
    },
    true,
  );

  // Drag from a titlebar / [data-drag-handle].
  document.addEventListener("pointerdown", function (e) {
    var handle = e.target.closest && e.target.closest("[data-drag-handle]");
    if (!handle) return;
    if (e.target.closest("[data-window-action], button, a, input, select, textarea"))
      return; // don't drag when grabbing a control
    var win = nearestWindow(handle);
    if (!win || win.classList.contains("vibe-win-max")) return;
    e.preventDefault();
    win.style.position = win.style.position || "absolute";
    var sx = e.clientX,
      sy = e.clientY;
    var ox = parseFloat(win.style.left) || win.offsetLeft;
    var oy = parseFloat(win.style.top) || win.offsetTop;
    function move(ev) {
      win.style.left = ox + (ev.clientX - sx) + "px";
      win.style.top = Math.max(0, oy + (ev.clientY - sy)) + "px";
    }
    function up() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  // Resize from [data-resize="se|e|s|sw|ne|nw|n|w"].
  document.addEventListener("pointerdown", function (e) {
    var h = e.target.closest && e.target.closest("[data-resize]");
    if (!h) return;
    var win = nearestWindow(h);
    if (!win || win.classList.contains("vibe-win-max")) return;
    e.preventDefault();
    e.stopPropagation();
    var dir = h.getAttribute("data-resize") || "se";
    var sx = e.clientX,
      sy = e.clientY;
    var r = win.getBoundingClientRect();
    var ox = parseFloat(win.style.left) || win.offsetLeft;
    var oy = parseFloat(win.style.top) || win.offsetTop;
    win.style.position = win.style.position || "absolute";
    function move(ev) {
      var dx = ev.clientX - sx,
        dy = ev.clientY - sy;
      if (dir.indexOf("e") > -1) win.style.width = Math.max(140, r.width + dx) + "px";
      if (dir.indexOf("s") > -1) win.style.height = Math.max(80, r.height + dy) + "px";
      if (dir.indexOf("w") > -1) {
        var w = Math.max(140, r.width - dx);
        win.style.width = w + "px";
        win.style.left = ox + (r.width - w) + "px";
      }
      if (dir.indexOf("n") > -1) {
        var hh = Math.max(80, r.height - dy);
        win.style.height = hh + "px";
        win.style.top = oy + (r.height - hh) + "px";
      }
    }
    function up() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  // Open a NEW nested window locally, then ask the agent to fill its content
  // (themed as an app of THIS environment — e.g. a Windows-98 program).
  var nwin = 0;
  var autoBody = 0;
  function buildNestedWindow(title, bodyId) {
    var tpl = document.querySelector("template[data-window-template]");
    var win;
    if (tpl && tpl.content.firstElementChild) {
      win = tpl.content.firstElementChild.cloneNode(true);
      if (!win.hasAttribute("data-window")) win.setAttribute("data-window", "");
      var ts = win.querySelector("[data-slot='title']");
      if (ts) ts.textContent = title;
      var bs =
        win.querySelector("[data-slot='content']") ||
        win.querySelector(".vibe-win-body");
      if (bs) {
        bs.id = bodyId;
        bs.textContent = "Loading…";
      }
    } else {
      win = document.createElement("div");
      win.className = "vibe-win";
      win.setAttribute("data-window", "");
      var bar = document.createElement("div");
      bar.className = "vibe-win-titlebar";
      bar.setAttribute("data-drag-handle", "");
      var t = document.createElement("span");
      t.style.flex = "1";
      t.textContent = title;
      bar.appendChild(t);
      ["minimize", "maximize", "close"].forEach(function (a) {
        var b = document.createElement("button");
        b.setAttribute("data-window-action", a);
        b.textContent = a === "close" ? "×" : a === "maximize" ? "□" : "_";
        bar.appendChild(b);
      });
      var body = document.createElement("div");
      body.className = "vibe-win-body";
      body.id = bodyId;
      body.textContent = "Loading…";
      var rz = document.createElement("span");
      rz.setAttribute("data-resize", "se");
      win.appendChild(bar);
      win.appendChild(body);
      win.appendChild(rz);
    }
    if (!win.style.width) win.style.width = "440px";
    if (!win.style.height) win.style.height = "320px";
    win.style.left = 36 + (nwin % 6) * 26 + "px";
    win.style.top = 36 + (nwin % 6) * 26 + "px";
    return win;
  }
  function openNestedWindow(appArg, title) {
    nwin++;
    var bodyId = "nwin-" + nwin;
    var surface =
      document.querySelector("[data-window-surface]") ||
      document.getElementById("vibe-root") ||
      document.body;
    if (getComputedStyle(surface).position === "static")
      surface.style.position = "relative";
    var win = buildNestedWindow(title, bodyId);
    surface.appendChild(win);
    raiseWindow(win);
    send("launch-window", appArg, bodyId); // agent fills #bodyId
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("input, textarea, select")) return; // editing a field
    // Launch a new nested app window (Start menu / desktop icon / app search).
    var lnch = e.target.closest("[data-launch]");
    if (lnch) {
      e.preventDefault();
      closeMenu();
      openNestedWindow(
        lnch.getAttribute("data-launch"),
        lnch.getAttribute("data-launch-title") || lnch.getAttribute("data-launch"),
      );
      return;
    }
    // Window control buttons (close / minimize / maximize) — local.
    var wa = e.target.closest("[data-window-action]");
    if (wa) {
      e.preventDefault();
      var win = nearestWindow(wa);
      var act = wa.getAttribute("data-window-action");
      if (win) {
        if (act === "close") win.remove();
        else if (act === "minimize") win.classList.toggle("vibe-win-min");
        else if (act === "maximize" || act === "restore")
          win.classList.toggle("vibe-win-max");
      }
      return;
    }
    // Menu trigger → open/close its popover locally (no agent call).
    var trig = e.target.closest("[data-menu]");
    if (trig) {
      e.preventDefault();
      toggleMenu(trig);
      return;
    }
    var t = e.target.closest("[data-action]");
    if (t) {
      e.preventDefault();
      closeMenu();
      var tgt = t.getAttribute("data-target");
      // Auto-target: a navigation click without an explicit target updates the
      // nearest content region — its [data-region], or (inside a nested window)
      // that window's own body. So folder/email/file lists browse IN PLACE, and a
      // nested window updates only itself, even without per-item data-target.
      if (!tgt) {
        var navVerb = /^(open|navigate|select|goto|show|view|browse|cd|enter)/i.test(
          t.getAttribute("data-action") || "",
        );
        if (t.matches(".vibe-list-row, .vibe-sidebar-item, [data-nav]") || navVerb) {
          var reg = t.closest("[data-region][id]");
          if (!reg) {
            var win = t.closest("[data-window]");
            if (win) {
              reg =
                win.querySelector("[data-region][id]") ||
                win.querySelector(".vibe-win-body, [data-slot='content'], [data-window-body]");
              if (reg && !reg.id) reg.id = "wbody-" + ++autoBody;
            }
          }
          if (reg && reg.id) tgt = reg.id;
        }
      }
      send(t.getAttribute("data-action"), t.getAttribute("data-arg"), tgt);
      return;
    }
    // Any link without an explicit data-action becomes a navigation.
    var a = e.target.closest("a");
    if (a) {
      e.preventDefault();
      closeMenu();
      var href = a.getAttribute("href");
      var target = href && href !== "#" ? href : a.textContent.trim();
      if (target) send("navigate", target);
      return;
    }
    // Safety net: a clearly-clickable control the app left unwired (no data-action,
    // no inline onclick, not a form submit) still triggers a generation — no dead
    // buttons. Locally-handled controls use inline onclick and are skipped.
    var c = e.target.closest(CLICKABLE);
    if (c && !c.disabled && !c.hasAttribute("onclick") && !c.closest("form")) {
      e.preventDefault();
      closeMenu();
      send("activate", label(c));
      return;
    }
    closeMenu(); // clicked empty space
  });

  // Submit on forms (or Enter inside a search box).
  document.addEventListener("submit", function (e) {
    var f = e.target.closest("[data-action]");
    if (!f) return;
    e.preventDefault();
    send(f.getAttribute("data-action"), f.getAttribute("data-arg"));
  });

  // Enter inside a text field submits its action (address bar, search, …).
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeMenu();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    var inp = e.target;
    if (!inp.matches || !inp.matches("input[data-action], .vibe-search input"))
      return;
    e.preventDefault();
    var host = inp.closest("[data-action]");
    var action = host ? host.getAttribute("data-action") : "search";
    send(action, inp.value);
  });

  // Non-text controls (select, checkbox, radio, slider…) act on change.
  document.addEventListener("change", function (e) {
    var el = e.target;
    if (
      !el.matches ||
      !el.matches(
        "select[data-action], input[type=checkbox][data-action]," +
          "input[type=radio][data-action], input[type=range][data-action]," +
          "input[type=date][data-action], input[type=color][data-action]," +
          "input[type=file][data-action]",
      )
    )
      return;
    send(el.getAttribute("data-action"), el.getAttribute("data-arg") || el.value);
  });

  // ---- In-place DOM patch (preserves focus/selection/scroll) --------------
  function keyOf(n) {
    return n.nodeType === 1 && n.id ? n.id : null;
  }
  function syncAttrs(from, to) {
    var ta = to.attributes, fa = from.attributes, i, a;
    for (i = ta.length - 1; i >= 0; i--) {
      a = ta[i];
      if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
    }
    for (i = fa.length - 1; i >= 0; i--) {
      a = fa[i];
      if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
    }
  }
  function morphNode(from, to, active) {
    if (from.nodeType !== 1) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    if (from.tagName === "SCRIPT") return; // never re-run / disturb scripts
    syncAttrs(from, to);
    var tag = from.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      // Don't clobber a field the user is editing.
      if (from !== active) {
        if (typeof to.value === "string" && from.value !== to.value)
          from.value = to.value;
      }
      return;
    }
    morphChildren(from, to, active);
  }
  function morphChildren(from, to, active) {
    var cf = from.firstChild, ct = to.firstChild;
    while (ct) {
      var nextT = ct.nextSibling;
      if (!cf) {
        from.appendChild(document.importNode(ct, true));
        ct = nextT;
        continue;
      }
      var kt = keyOf(ct);
      if (kt) {
        var s = cf, found = null;
        while (s) {
          if (keyOf(s) === kt) {
            found = s;
            break;
          }
          s = s.nextSibling;
        }
        if (found) {
          if (found !== cf) from.insertBefore(found, cf);
          morphNode(found, ct, active);
          cf = found.nextSibling;
        } else {
          from.insertBefore(document.importNode(ct, true), cf);
        }
        ct = nextT;
        continue;
      }
      if (
        cf.nodeType === ct.nodeType &&
        (cf.nodeType !== 1 || cf.tagName === ct.tagName) &&
        !keyOf(cf)
      ) {
        morphNode(cf, ct, active);
        cf = cf.nextSibling;
        ct = nextT;
      } else {
        from.insertBefore(document.importNode(ct, true), cf);
        ct = nextT;
      }
    }
    while (cf) {
      var rm = cf;
      cf = cf.nextSibling;
      from.removeChild(rm);
    }
  }
  function patchEl(root, html) {
    if (!root) return;
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var active = document.activeElement;
    var selStart = active && "selectionStart" in active ? active.selectionStart : null;
    var selEnd = active && "selectionEnd" in active ? active.selectionEnd : null;
    var activeId = active ? keyOf(active) : null;
    morphChildren(root, tmp, active);
    // Restore focus/caret if the focused field survived by id.
    if (activeId) {
      var again = document.getElementById(activeId);
      if (again && again !== document.activeElement) {
        try {
          again.focus();
          if (selStart != null && "setSelectionRange" in again)
            again.setSelectionRange(selStart, selEnd);
        } catch (e) {}
      }
    }
  }

  // ---- Slots: a node declares child nodes as [data-node] placeholders; the OS
  // fills each by generating its content. Fired per-slot, so siblings (e.g. a
  // desktop's windows) generate IN PARALLEL.
  function fillSlots() {
    var slots = document.querySelectorAll("[data-node]:not([data-node-filled])");
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      s.setAttribute("data-node-filled", "");
      if (!s.id) s.id = "node-" + ++autoBody;
      if (!s.innerHTML.trim())
        s.innerHTML =
          '<div style="padding:14px;color:#888;font-size:12px">Loading…</div>';
      send("render-node", s.getAttribute("data-node"), s.id);
    }
  }

  // Commands from the shell.
  window.addEventListener("message", function (e) {
    var msg = e.data || {};
    if (msg.type === "vibe-patch" && typeof msg.html === "string") {
      patchEl(document.getElementById("vibe-root"), msg.html);
      fillSlots();
    } else if (msg.type === "vibe-patch-region" && typeof msg.html === "string") {
      var el = document.getElementById(msg.target);
      if (el) {
        patchEl(el, msg.html);
        var bw = el.closest("[data-window]") || el;
        bw.classList.remove("vibe-busy");
        clearTimeout(bw._vibeBusyT);
        fillSlots();
      }
      // Region not found (agent renamed/removed it) → ask the OS to fully
      // re-render so we never end up with a stale/empty window.
      else
        parent.postMessage(
          { type: "vibe-region-miss", windowId: WINDOW_ID, target: msg.target },
          "*",
        );
    }
  });

  fillSlots(); // fill any slots present in the initial render
})();
