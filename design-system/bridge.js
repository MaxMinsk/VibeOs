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

  // Commands from the shell (e.g. show a spinner) — reserved for later use.
  window.addEventListener("message", function (e) {
    var msg = e.data || {};
    if (msg.type === "vibe-cmd") {
      // no-op placeholder for now
    }
  });
})();
