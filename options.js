"use strict";
// Our connection to Thunderbird's extension API. Thunderbird provides it under two names, "messenger" and "browser"; use whichever exists.
const api = typeof messenger !== "undefined" ? messenger : browser;
const DEFAULTS = { keepTagOpen: false, currentAccountOnly: false };
// Shows the two settings as checkboxes (saved in the add-on's local storage) and saves each one as soon as it is changed.
(async function () {
  let s = DEFAULTS;
  try { s = Object.assign({}, DEFAULTS, (await api.storage.local.get("settings")).settings || {}); } catch (e) { /* defaults */ }
  for (const k of Object.keys(DEFAULTS)) {
    const el = document.getElementById(k);
    el.checked = !!s[k];
    el.addEventListener("change", async () => {
      s[k] = el.checked;
      try { await api.storage.local.set({ settings: s }); } catch (e) { /* ignore */ }
    });
  }
})();
