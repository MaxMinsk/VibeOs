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

  function send(action, arg, extra) {
    parent.postMessage(
      {
        type: "vibe-event",
        windowId: WINDOW_ID,
        event: {
          action: action,
          arg: arg == null ? null : arg,
          formState: collectFormState(),
          extra: extra || null,
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

  document.addEventListener("click", function (e) {
    if (e.target.closest("input, textarea, select")) return; // editing a field
    var t = e.target.closest("[data-action]");
    if (t) {
      e.preventDefault();
      send(t.getAttribute("data-action"), t.getAttribute("data-arg"));
      return;
    }
    // Any link without an explicit data-action becomes a navigation.
    var a = e.target.closest("a");
    if (a) {
      e.preventDefault();
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
      send("activate", label(c));
    }
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
  function patch(html) {
    var root = document.getElementById("vibe-root");
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

  // Commands from the shell.
  window.addEventListener("message", function (e) {
    var msg = e.data || {};
    if (msg.type === "vibe-patch" && typeof msg.html === "string") patch(msg.html);
  });
})();
