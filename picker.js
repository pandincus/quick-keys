"use strict";
// Type-ahead picker for tags (toggle) and folders (move). Runs in the popup window opened by background.js.
const A = typeof messenger !== "undefined" ? messenger : browser;
const $ = id => document.getElementById(id);
const mode = new URLSearchParams(location.search).get("mode") === "move" ? "move" : "tag";
let pending = null;
let items = [];          // everything that can be chosen
let shown = [];          // items matching the text typed so far
let sel = 0;
let busy = false;
let settings = { keepTagOpen: false, currentAccountOnly: false };

const HINT = {
  tag: "↑↓ choose  ·  Enter toggle  ·  Shift+Enter toggle and keep open  ·  Esc cancel",
  move: "↑↓ choose  ·  Enter move  ·  Esc cancel",
};

function say(text, cls) { const f = $("foot"); f.textContent = text; f.className = cls || ""; }

// ---- ranking: name starts with the text > a word in the name starts with it > name contains it > path/account contains it
function rank(it, q) {
  if (!q) return 5;
  const n = it.name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\/_\-.\[\]]+/).some(w => w.startsWith(q))) return 1;
  if (n.includes(q)) return 2;
  if (it.sub.toLowerCase().includes(q)) return 3;
  return -1;
}

function refilter() {
  const q = $("q").value.trim().toLowerCase();
  shown = items.map((it, i) => [it, rank(it, q), i]).filter(x => x[1] >= 0)
    .sort((a, b) => a[1] - b[1] || (b[0].recent ? 1 : 0) - (a[0].recent ? 1 : 0) || a[2] - b[2]).map(x => x[0]);
  if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
  render();
}

function tagState(key) {                   // "all" | "some" | "none" across the selected messages
  const n = pending.tags.filter(t => t.includes(key)).length;
  return n === 0 ? "none" : n === pending.tags.length ? "all" : "some";
}

function render() {
  const ul = $("list");
  ul.textContent = "";
  shown.forEach((it, i) => {
    const li = document.createElement("li");
    if (i === sel) li.className = "sel";
    if (mode === "tag") {
      const st = document.createElement("span");
      st.className = "st";
      const s = tagState(it.key);
      st.textContent = s === "all" ? "✓" : s === "some" ? "–" : "";
      li.appendChild(st);
      if (it.color) { const d = document.createElement("span"); d.className = "dot"; d.style.background = it.color; li.appendChild(d); }
    }
    const nm = document.createElement("span");
    nm.className = "nm"; nm.textContent = it.name;
    li.appendChild(nm);
    const sub = document.createElement("span");
    sub.className = "sub"; sub.textContent = it.sub;
    li.appendChild(sub);
    li.addEventListener("mousedown", e => { e.preventDefault(); sel = i; apply(false); });
    ul.appendChild(li);
  });
  const cur = ul.children[sel];
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
}

async function loadTags() {
  const list = A.messages.tags ? await A.messages.tags.list() : await A.messages.listTags();
  items = list.map(t => ({ key: t.key, name: String(t.tag || t.key), sub: "", color: t.color }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function loadFolders() {
  const accounts = await A.accounts.list(false);
  const acctName = new Map(accounts.map(a => [a.id, a.name]));
  const order = new Map(accounts.map((a, i) => [a.id, i]));
  const all = await A.folders.query({});
  let recent = [];
  try { recent = (await A.storage.local.get("recentFolders")).recentFolders || []; } catch (e) { /* no storage */ }
  const only = settings.currentAccountOnly && pending.accounts && pending.accounts.length ? new Set(pending.accounts) : null;
  items = all.filter(f => f.path && f.path !== "/" && (!only || only.has(f.accountId))).map(f => ({
    id: f.id, name: f.name, sub: (acctName.get(f.accountId) || "") + "  " + f.path, path: f.path,
    recent: recent.includes(f.id), ord: order.get(f.accountId) ?? 99,
  })).sort((a, b) => (b.recent ? 1 : 0) - (a.recent ? 1 : 0) || a.ord - b.ord || a.path.localeCompare(b.path));
  // recently used folders in the order they were used
  const rIndex = id => { const i = recent.indexOf(id); return i < 0 ? 99 : i; };
  items.sort((a, b) => (a.recent && b.recent) ? rIndex(a.id) - rIndex(b.id) : 0);
}

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
      for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map(([id, tags]) => A.messages.update(id, { tags })));
      say((on ? "Added " : "Removed ") + "\"" + it.name + "\" " + (on ? "to " : "from ") + pending.ids.length + " message(s).", "ok");
    } else {
      for (let i = 0; i < pending.ids.length; i += 200) await A.messages.move(pending.ids.slice(i, i + 200), it.id);
      try {
        const recent = (await A.storage.local.get("recentFolders")).recentFolders || [];
        await A.storage.local.set({ recentFolders: [it.id].concat(recent.filter(x => x !== it.id)).slice(0, 8) });
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

(async function init() {
  try {
    say("Reading the selected messages...");
    try { settings = Object.assign(settings, (await A.storage.local.get("settings")).settings || {}); } catch (e) { /* defaults */ }
    pending = await A.runtime.sendMessage({ type: "getPending" });
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
