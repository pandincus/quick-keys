"use strict";
// Quick Keys: on a shortcut, act on the selected messages. The tag and move shortcuts open a small type-ahead popup (picker.html).
const A = typeof messenger !== "undefined" ? messenger : browser;
let pendingPromise = Promise.resolve(null);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + " timed out after " + ms / 1000 + " s")), ms))]);
const open = { help: null, picker: null };      // window ids of the popups, so a second press reuses or replaces them

// Finds the selected messages. A background script has no "current window", so try several ways to find the mail tab.
async function selectedMessages() {
  const dbg = [];
  const tabs = [];
  const seen = new Set();
  const add = list => { for (const t of list || []) if (!seen.has(t.id)) { seen.add(t.id); tabs.push(t); } };
  for (const q of [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }]) {
    try { add(await A.mailTabs.query(q)); } catch (e) { dbg.push("mailTabs.query: " + e.message); }
  }
  try {
    const wins = await A.windows.getAll({ windowTypes: ["normal"] });
    wins.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
    for (const w of wins) { try { add(await A.mailTabs.query({ active: true, windowId: w.id })); } catch (e) { dbg.push("window " + w.id + ": " + e.message); } }
  } catch (e) { dbg.push("windows.getAll: " + e.message); }
  dbg.push(tabs.length + " mail tab(s) found");
  for (const t of tabs) {
    try {
      let page = await A.mailTabs.getSelectedMessages(t.id);
      let msgs = page.messages.slice();
      while (page.id && msgs.length < 10000) { page = await A.messages.continueList(page.id); msgs.push(...page.messages); }
      if (msgs.length) return { msgs, dbg };
      dbg.push("tab " + t.id + ": nothing selected");
    } catch (e) { dbg.push("tab " + t.id + ": " + e.message); }
  }
  // a message opened in its own tab or window: ask each active tab in each window what it displays.
  // (Depending on the Thunderbird version the answer is a plain array of messages or an object with a "messages" list.)
  try {
    const wins = await A.windows.getAll({ windowTypes: ["normal", "messageDisplay"] });
    wins.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
    for (const w of wins) {
      for (const t of await A.tabs.query({ active: true, windowId: w.id })) {
        try {
          const r = await A.messageDisplay.getDisplayedMessages(t.id);
          const list = Array.isArray(r) ? r : (r && r.messages) || [];
          if (list.length) return { msgs: list, dbg };
        } catch (e) { dbg.push("tab " + t.id + " displayed: " + e.message); }
      }
    }
  } catch (e) { dbg.push("displayed message: " + e.message); }
  return { msgs: [], dbg };
}

async function closeIfOpen(kind) {
  if (open[kind] === null) return;
  const id = open[kind];
  open[kind] = null;
  try { await A.windows.remove(id); } catch (e) { /* already closed */ }
}

async function openPopup(kind, url, width, height) {
  const w = await A.windows.create({ url, type: "popup", width, height });
  open[kind] = w.id;
}

A.windows.onRemoved.addListener(id => { for (const k of Object.keys(open)) if (open[k] === id) open[k] = null; });

async function markRead(read) {
  const { msgs } = await selectedMessages();
  const todo = msgs.filter(m => !!m.read !== read);
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(todo.slice(i, i + 20).map(m => A.messages.update(m.id, { read })));
  }
}

A.commands.onCommand.addListener(async name => {
  console.log("Quick Keys: command", name);
  try {
    if (name === "show-help") {
      if (open.help !== null) {                  // already showing: bring it to the front instead of opening another
        try { await A.windows.update(open.help, { focused: true }); return; } catch (e) { open.help = null; }
      }
      await openPopup("help", "help.html", 560, 480);
      return;
    }
    if (name === "mark-read") { await markRead(true); return; }
    if (name === "mark-unread") { await markRead(false); return; }
    const mode = name === "pick-tag" ? "tag" : name === "pick-move" ? "move" : null;
    if (!mode) return;
    // open the popup straight away; it asks for the selection, which is read in the background (with a time limit)
    pendingPromise = withTimeout(selectedMessages(), 6000, "reading the selection").then(({ msgs, dbg }) => {
      if (!msgs.length) return { mode, error: "Quick Keys could not see any selected messages. Click a message in the list first.", debug: dbg.join(" | ") };
      return {
        mode,
        ids: msgs.map(m => m.id),
        tags: msgs.map(m => (m.tags || []).slice()),
        accounts: Array.from(new Set(msgs.map(m => m.folder && m.folder.accountId).filter(Boolean))),
      };
    }).catch(e => ({ mode, error: "Quick Keys had a problem: " + (e && e.message ? e.message : e) }));
    await closeIfOpen("picker");                 // a new request replaces any picker that is still open
    await openPopup("picker", "picker.html?mode=" + mode, 540, 440);
  } catch (e) {
    console.error("Quick Keys:", e);
  }
});

A.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === "getPending") return pendingPromise;
  return undefined;
});
