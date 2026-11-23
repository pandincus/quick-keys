"use strict";
// Type-ahead picker for tags (toggle) and folders (move). Runs in the popup window opened by background.js.
// Our connection to Thunderbird's extension API. Thunderbird provides it under two names, "messenger" and "browser"; use whichever exists.
const api = typeof messenger !== "undefined" ? messenger : browser;
const $ = id => document.getElementById(id);          // shorthand: find an element of picker.html by its id
const mode = new URLSearchParams(location.search).get("mode") === "move" ? "move" : "tag";
let pending = null;      // the selection, from background.js: { ids, tags (one list per message), accounts } or { error }
let items = [];          // everything that can be chosen
let shown = [];          // items matching the text typed so far
let sel = 0;
let busy = false;
let settings = { keepTagOpen: false, currentAccountOnly: false };

const HINT = {
  tag: "↑↓ choose  ·  Enter toggle  ·  Shift+Enter toggle and keep open  ·  Esc cancel",
  move: "↑↓ choose  ·  Enter move  ·  Esc cancel",
};

/** Shows `text` in the footer line. `cls` is "ok" (green), "bad" (red) or omitted (plain). */
function say(text, cls) { const f = $("foot"); f.textContent = text; f.className = cls || ""; }

/**
 * Scores how well item `it` matches the typed text `q` (already lower-case), lower being better; -1 means no match.
 * Order: name starts with the text, a word in the name starts with it, name contains it, path or account contains it.
 */
function rank(it, q) {
  if (!q) return 5;
  const n = it.name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\/_\-.\[\]]+/).some(w => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  if (it.sub.toLowerCase().includes(q)) return 3;
  return -1;
}

/** Rebuilds `shown` (the items matching the typed text, best first, recently used folders ahead of equals) and redraws the list. */
function refilter() {
  const q = $("q").value.trim().toLowerCase();
  shown = items.map((it, i) => [it, rank(it, q), i]).filter(x => x[1] >= 0)
    .sort((a, b) => a[1] - b[1] || (b[0].recent ? 1 : 0) - (a[0].recent ? 1 : 0) || a[2] - b[2]).map(x => x[0]);
  if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
  render();
}

/** For the tag with this `key`: "all", "some" or "none" of the selected messages have it. */
function tagState(key) {
  const n = pending.tags.filter(t => t.includes(key)).length;
  return n === 0 ? "none" : n === pending.tags.length ? "all" : "some";
}

/**
 * Draws the list of `shown` items. Each row is a copy of the <template id="row"> in picker.html with its text filled in:
 * tags get a tick column (✓ all, – some) and a colour dot; folders show only the name and the account/path.
 */
function render() {
  const ul = $("list");
  ul.textContent = "";
  const rowTemplate = $("row");
  shown.forEach((it, i) => {
    const li = rowTemplate.content.firstElementChild.cloneNode(true);
    if (i === sel) li.className = "sel";
    const st = li.querySelector(".st"), dot = li.querySelector(".dot");
    if (mode === "tag") {
      const s = tagState(it.key);
      st.textContent = s === "all" ? "✓" : s === "some" ? "–" : "";
      if (it.color) dot.style.background = it.color; else dot.remove();
    } else {
      st.remove(); dot.remove();
    }
    li.querySelector(".nm").textContent = it.name;
    li.querySelector(".sub").textContent = it.sub;
    li.addEventListener("mousedown", e => { e.preventDefault(); sel = i; apply(false); });
    ul.appendChild(li);
  });
  const cur = ul.children[sel];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
}

/** Fills `items` with every tag Thunderbird knows, sorted by name. */
async function loadTags() {
  const list = await api.messages.tags.list();
  items = list.map(t => ({ key: t.key, name: String(t.tag || t.key), sub: "", color: t.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fills `items` with the folders that can be chosen: recently used ones first (most recent first), then by account and path.
 * If the "current account only" setting is on, only folders of the accounts the selected messages belong to are offered.
 */
async function loadFolders() {
  const accounts = await api.accounts.list(false);
  const acctName = new Map(accounts.map(a => [a.id, a.name]));
  const order = new Map(accounts.map((a, i) => [a.id, i]));
  const all = await api.folders.query({});
  let recent = [];
  try { recent = (await api.storage.local.get("recentFolders")).recentFolders || []; } catch (e) { /* no storage */ }
  const only = settings.currentAccountOnly && pending.accounts && pending.accounts.length ? new Set(pending.accounts) : null;
  items = all.filter(f => f.path && f.path !== "/" && (!only || only.has(f.accountId))).map(f => ({
    id: f.id, name: f.name, sub: (acctName.get(f.accountId) || "") + "  " + f.path, path: f.path,
    recent: recent.includes(f.id), ord: order.get(f.accountId) ?? 99,
  })).sort((a, b) => (b.recent ? 1 : 0) - (a.recent ? 1 : 0) || a.ord - b.ord || a.path.localeCompare(b.path));
  // recently used folders in the order they were used
  const rIndex = id => { const i = recent.indexOf(id); return i < 0 ? 99 : i; };
  items.sort((a, b) => (a.recent && b.recent) ? rIndex(a.id) - rIndex(b.id) : 0);
}

/**
 * Applies the highlighted item to the selected messages, then closes the popup.
 * Tag mode: adds the tag, or removes it if every selected message already has it. Folder mode: moves the messages there
 * and remembers the folder as recently used. With `keepOpen` true (Shift+Enter, or the option), tag mode stays open for more tags.
 */
async function apply(keepOpen) {
  if (busy || !shown.length) return;
  const it = shown[sel];
  busy = true;
  try {
    if (mode === "tag") {
      const on = tagState(it.key) !== "all";           // everything already has it -> remove it, otherwise add it
      const jobs = [];
      pending.ids.forEach((id, i) => {
        const cur = pending.tags[i];
        const next = on ? (cur.includes(it.key) ? cur : cur.concat(it.key)) : cur.filter(k => k !== it.key);
        if (next !== cur && (on || cur.includes(it.key))) { pending.tags[i] = next; jobs.push([id, next]); }
      });
      for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map(([id, tags]) => api.messages.update(id, { tags })));
      say((on ? "Added " : "Removed ") + "\"" + it.name + "\" " + (on ? "to " : "from ") + pending.ids.length + " message(s).", "ok");
    } else {
      for (let i = 0; i < pending.ids.length; i += 200) await api.messages.move(pending.ids.slice(i, i + 200), it.id);
      try {
        const recent = (await api.storage.local.get("recentFolders")).recentFolders || [];
        await api.storage.local.set({ recentFolders: [it.id].concat(recent.filter(x => x !== it.id)).slice(0, 8) });
      } catch (e) { /* recents are optional */ }
      say("Moved " + pending.ids.length + " message(s) to " + it.name + ".", "ok");
    }
    busy = false;
    if ((keepOpen || settings.keepTagOpen) && mode === "tag") { render(); return; }
    setTimeout(() => window.close(), 60);
  } catch (e) {
    busy = false;
    say("Failed: " + (e && e.message ? e.message : e), "bad");
  }
}

$("q").addEventListener("input", () => { sel = 0; refilter(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { window.close(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); if (sel < shown.length - 1) sel++; render(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); if (sel > 0) sel--; render(); }
  else if (e.key === "Enter") { e.preventDefault(); apply(e.shiftKey); }
});

/** Starts the popup: loads settings and the selection from background.js, then the tag or folder list, and focuses the text box. */
(async function init() {
  try {
    say("Reading the selected messages...");
    try { settings = Object.assign(settings, (await api.storage.local.get("settings")).settings || {}); } catch (e) { /* defaults */ }
    pending = await api.runtime.sendMessage({ type: "getPending" });
    if (!pending) { say("No messages were selected.", "bad"); setTimeout(() => window.close(), 900); return; }
    if (pending.error) {                               // the shortcut fired but the selection could not be read
      $("title").textContent = "Quick Keys";
      say(pending.error + (pending.debug ? "  [" + pending.debug + "]" : ""), "bad");
      $("q").disabled = true;
      return;
    }
    $("title").textContent = mode === "tag" ? "Tag (toggle)" : "Move to folder";
    $("count").textContent = pending.ids.length + " message" + (pending.ids.length === 1 ? "" : "s") + " selected";
    $("q").placeholder = mode === "tag" ? "Type part of a tag name..." : "Type part of a folder name...";
    if (mode === "tag") await loadTags(); else await loadFolders();
    refilter();
    say(HINT[mode]);
    $("q").focus();
  } catch (e) {
    say("Could not start: " + (e && e.message ? e.message : e), "bad");
  }
})();
