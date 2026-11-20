"use strict";
// Shows the extension's current shortcuts (including any the user has changed) in a small popup.
const A = typeof messenger !== "undefined" ? messenger : browser;
(async function () {
  const t = document.getElementById("t");
  try {
    const cmds = await A.commands.getAll();
    for (const c of cmds) {
      if (!c.description) continue;                       // skip the built-in action commands
      const tr = document.createElement("tr");
      const k = document.createElement("td"); k.className = "k";
      if (c.shortcut) {
        c.shortcut.split("+").forEach((part, i) => {
          if (i) k.appendChild(document.createTextNode("+"));
          const kbd = document.createElement("kbd"); kbd.textContent = part; k.appendChild(kbd);
        });
      } else { const n = document.createElement("span"); n.className = "none"; n.textContent = "not set"; k.appendChild(n); }
      const d = document.createElement("td"); d.textContent = c.description;
      tr.appendChild(k); tr.appendChild(d); t.appendChild(tr);
    }
  } catch (e) {
    t.textContent = "Could not read the shortcuts: " + (e && e.message ? e.message : e);
  }
})();
document.addEventListener("keydown", e => { if (e.key === "Escape" || e.key === "F1") window.close(); });
