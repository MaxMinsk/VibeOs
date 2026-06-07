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

  // Click on any element carrying data-action.
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action]");
    if (t) {
      e.preventDefault();
      send(t.getAttribute("data-action"), t.getAttribute("data-arg"));
      return;
    }
    // Any link without an explicit data-action becomes a navigation (the agent
    // generates the target). Real network navigation is blocked anyway.
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

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var inp = e.target;
    if (!inp.matches || !inp.matches(".vibe-search input, input[data-action]"))
      return;
    var host = inp.closest("[data-action]") || inp;
    e.preventDefault();
    send(
      host.getAttribute && host.getAttribute("data-action")
        ? host.getAttribute("data-action")
        : "search",
      inp.value,
    );
  });

  // Commands from the shell (e.g. show a spinner) — reserved for later use.
  window.addEventListener("message", function (e) {
    var msg = e.data || {};
    if (msg.type === "vibe-cmd") {
      // no-op placeholder for now
    }
  });
})();
