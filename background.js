"use strict";
// Quick Keys: on a shortcut, act on the selected messages. The tag and move shortcuts open a small type-ahead popup (picker.html).

// Our connection to Thunderbird's extension API. Thunderbird provides it under two names, "messenger" and "browser"; use whichever exists.
const api = typeof messenger !== "undefined" ? messenger : browser;

// The most messages one shortcut will act on. Selecting more than this (say Ctrl+A on a huge folder) quietly uses only the first
// part of the selection. Messages are read from Thunderbird in pages, so the real count can run a little over this number
// (for example 10,100 if a page straddles the limit). Raising it is safe; it only makes the popup slower to open on giant selections.
const MAX_MESSAGES = 10000;

let pendingPromise = Promise.resolve(null);     // the selection for the picker popup; the popup asks for it once it has opened

/**
 * Rejects if `promise` takes longer than `ms` milliseconds; otherwise passes its result through. `what` names the job in the error text.
 */
const withTimeout = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(what + " timed out after " + ms / 1000 + " s")), ms))]);

const open = { help: null, picker: null };      // window ids of the popups, so a second press reuses or replaces them

/**
 * Finds the selected messages. A background script has no "current window", so this tries several ways to find the mail tab.
 * Returns { msgs, debug }: `msgs` is the list of selected messages (empty if none could be found) and `debug` is a list of
 * notes about what was tried, shown to the user if nothing was found.
 */
async function selectedMessages() {
  const debug = [];

  // 1. Mail tabs to ask, most likely first. A tab can turn up in more than one search, so each is kept once, by id.
  const tabs = [];
  const seen = new Set();
  const addTabs = list => { for (const tab of list || []) if (!seen.has(tab.id)) { seen.add(tab.id); tabs.push(tab); } };

  const searches = [{ active: true, currentWindow: true }, { active: true, lastFocusedWindow: true }];
  try {
    const windows = await api.windows.getAll({ windowTypes: ["normal"] });
    windows.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));     // the focused window first
    for (const win of windows) searches.push({ active: true, windowId: win.id });
  } catch (e) { debug.push("windows.getAll: " + e.message); }

  for (const search of searches) {
    try { addTabs(await api.mailTabs.query(search)); } catch (e) { debug.push("mailTabs.query " + JSON.stringify(search) + ": " + e.message); }
  }
  debug.push(tabs.length + " mail tab(s) found");

  // 2. Ask each mail tab for its selected messages; the first tab with a selection wins.
  for (const tab of tabs) {
    try {
      let page = await api.mailTabs.getSelectedMessages(tab.id);
      const msgs = page.messages.slice();
      while (page.id && msgs.length < MAX_MESSAGES) { page = await api.messages.continueList(page.id); msgs.push(...page.messages); }
      if (msgs.length) return { msgs, debug };
      debug.push("tab " + tab.id + ": nothing selected");
    } catch (e) { debug.push("tab " + tab.id + ": " + e.message); }
  }

  // 3. A message opened in its own tab or window: ask each active tab in each window what it displays.
  // (Depending on the Thunderbird version the answer is a plain array of messages or an object with a "messages" list.)
  try {
    const windows = await api.windows.getAll({ windowTypes: ["normal", "messageDisplay"] });
    windows.sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));
    for (const win of windows) {
      for (const tab of await api.tabs.query({ active: true, windowId: win.id })) {
        try {
          const result = await api.messageDisplay.getDisplayedMessages(tab.id);
          const list = Array.isArray(result) ? result : (result && result.messages) || [];
          if (list.length) return { msgs: list, debug };
        } catch (e) { debug.push("tab " + tab.id + " displayed: " + e.message); }
      }
    }
  } catch (e) { debug.push("displayed message: " + e.message); }
  return { msgs: [], debug };
}

/**
 * Closes the popup of the given kind ("help" or "picker") if one is open.
 */
async function closeIfOpen(kind) {
  if (open[kind] === null) return;
  const id = open[kind];
  open[kind] = null;
  try { await api.windows.remove(id); } catch (e) { /* already closed */ }
}

/**
 * Opens a popup window showing `url` (a page of this add-on, `width` x `height` pixels) and remembers it under `kind` ("help" or "picker").
 */
async function openPopup(kind, url, width, height) {
  const win = await api.windows.create({ url, type: "popup", width, height });
  open[kind] = win.id;
}

api.windows.onRemoved.addListener(id => { for (const k of Object.keys(open)) if (open[k] === id) open[k] = null; });

/**
 * Marks the selected messages as read (`read` is true) or as unread (`read` is false).
 * Messages that are already in the wanted state are skipped, and updates go out 20 at a time.
 */
async function markRead(read) {
  const { msgs } = await selectedMessages();
  const todo = msgs.filter(m => !!m.read !== read);
  for (let i = 0; i < todo.length; i += 20) {
    await Promise.all(todo.slice(i, i + 20).map(m => api.messages.update(m.id, { read })));
  }
}

// Runs when one of the shortcuts (see "commands" in manifest.json) is pressed. `name` is the command's name.
api.commands.onCommand.addListener(async name => {
  console.log("Quick Keys: command", name);
  try {
    if (name === "show-help") {
      if (open.help !== null) {                  // already showing: bring it to the front instead of opening another
        try { await api.windows.update(open.help, { focused: true }); return; } catch (e) { open.help = null; }
      }
      await openPopup("help", api.runtime.getURL("help.html"), 560, 480);
      return;
    }
    if (name === "mark-read") { await markRead(true); return; }
    if (name === "mark-unread") { await markRead(false); return; }
    const mode = name === "pick-tag" ? "tag" : name === "pick-move" ? "move" : null;
    if (!mode) return;
    // open the popup straight away; it asks for the selection, which is read in the background (with a time limit)
    pendingPromise = withTimeout(selectedMessages(), 6000, "reading the selection").then(({ msgs, debug }) => {
      if (!msgs.length) return { mode, error: "Quick Keys could not see any selected messages. Click a message in the list first.", debug: debug.join(" | ") };
      return {
        mode,
        ids: msgs.map(m => m.id),
        tags: msgs.map(m => (m.tags || []).slice()),
        accounts: Array.from(new Set(msgs.map(m => m.folder && m.folder.accountId).filter(Boolean))),
      };
    }).catch(e => ({ mode, error: "Quick Keys had a problem: " + (e && e.message ? e.message : e) }));
    await closeIfOpen("picker");                 // a new request replaces any picker that is still open
    await openPopup("picker", api.runtime.getURL("picker.html") + "?mode=" + mode, 540, 440);
  } catch (e) {
    console.error("Quick Keys:", e);
  }
});

// The picker popup asks for the selection that the shortcut found; answer with that (still loading, perhaps) result.
api.runtime.onMessage.addListener(msg => {
  if (msg && msg.type === "getPending") return pendingPromise;
  return undefined;
});
