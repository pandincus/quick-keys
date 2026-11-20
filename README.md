# Quick Keys: Tag, Move, Mark (Thunderbird add-on)

Keyboard shortcuts for fast inbox triage. Select one or more messages, then:

| Default shortcut | What it does |
|---|---|
| **Ctrl+Alt+L** | Tag picker: type part of a tag name, **Enter** toggles it on the selected messages (Shift+Enter keeps the picker open to add several) |
| **Ctrl+Alt+V** | Move picker: type part of a folder name, **Enter** moves the selected messages there. Recently used folders come first |
| **Ctrl+Alt+I** | Mark as read |
| **Ctrl+Alt+U** | Mark as unread |
| **F1** | Show the current shortcuts |

Thunderbird's own shortcuts (A to archive, Delete, T, 1 to 9 for the first nine tags) are untouched.

Change any shortcut under Add-ons and Themes, gear menu, **Manage Extension Shortcuts**. F1 always shows the current bindings.
Options (add-on preferences): keep the tag picker open after applying a tag; only offer folders from the selected messages' account.

## Privacy
Nothing leaves your computer. The add-on makes no network requests, collects no data, and only stores two settings and a short list of recently used folders in Thunderbird's local add-on storage. See PRIVACY.md.

## Permissions, and why
`accountsRead`, `accountsFolders` (list folders for the move picker) - `messagesRead` (see which messages are selected and their tags) - `messagesMove` (move) - `messagesUpdate` (mark read/unread, set tags) - `messagesTags`, `messagesTagsList` (list the tags) - `storage` (settings and recent folders).

## Status
Version 0.2.0, untested in a published release. Written for Thunderbird 115 and later (MV2 WebExtension, no privileged code).
Shortcuts need a modifier key because Thunderbird's extension shortcut system does not allow plain letters (F-keys excepted).

## License
MIT. See LICENSE.
