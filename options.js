"use strict";
const A = typeof messenger !== "undefined" ? messenger : browser;
const DEFAULTS = { keepTagOpen: false, currentAccountOnly: false };
(async function () {
  let s = DEFAULTS;
  try { s = Object.assign({}, DEFAULTS, (await A.storage.local.get("settings")).settings || {}); } catch (e) { /* defaults */ }
  for (const k of Object.keys(DEFAULTS)) {
    const el = document.getElementById(k);
    el.checked = !!s[k];
    el.addEventListener("change", async () => {
      s[k] = el.checked;
      try { await A.storage.local.set({ settings: s }); } catch (e) { /* ignore */ }
    });
  }
})();
