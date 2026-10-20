# Labradorite guide

A local-first writing space in your browser, powered by Go. Notes are plain
Markdown files in a folder you choose. The app offers a WYSIWYG editor, Markdown
source, rendered preview, split view, body search, focus mode, 14 themes and
browser draft recovery.

Labradorite is AI-made software, built with Claude and Codex. Keep important notes
backed up and try it on a copy of your vault first.

The first time it starts without a vault argument, Labradorite creates its notebook
with a short **Welcome to Labradorite** note; delete it whenever you like. Folders
you open yourself are never given one.

## Run it

Release archives on the [Releases](https://github.com/eg36/Labradorite/releases)
page hold the `labradorite` binary; run it from the unpacked folder. To build it
instead, Go **1.26+** is the only requirement. Browser assets are bundled and
committed: Node and npm are **not** needed to run the app, and there are no CDNs
or runtime third-party requests.

```sh
git clone git@github.com:eg36/Labradorite.git
cd Labradorite
go build -o bin/labradorite ./cmd/labradorite
./bin/labradorite
```

The app opens **http://127.0.0.1:4280** in your default browser; a current
Chrome/Chromium, Firefox or Safari works. The terminal prints the address and
vault path too. Keep that process running while
using the app; Ctrl+C stops it. There is no account, cloud sync, telemetry,
database or remote access mode.

**Install it as an app:** Chrome and Edge offer *Install Labradorite* in the
address bar or menu. The installed app opens in its own window with the
Labradorite icon; it still needs `labradorite` running to work.

### Choose a vault

```sh
./bin/labradorite ~/Notes                  # open an existing Markdown vault
./bin/labradorite -data-dir /tmp/test      # isolated notes AND theme settings
./bin/labradorite -listen 127.0.0.1:4390   # choose another local port
./bin/labradorite -no-browser              # print the address without opening it
./bin/labradorite -version
```

Flags go **before** the optional vault path. The app only accepts loopback
listeners; it cannot be exposed on `0.0.0.0`, a LAN IP or a public host. Browser
and server must be on the same computer. This is not a hosted multi-user service.

The default vault is:

- Linux: `$XDG_DATA_HOME/labradorite`, or `~/.local/share/labradorite`.
- macOS: `~/Library/Application Support/labradorite` (not verified on a Mac).
- Windows: `%AppData%\labradorite` (not tested).

Labradorite was called coyotenote until v0.6.1. On its first start without
`-data-dir`, it moves the former default folder (`coyotenote-web` beside the new
one) to the new name, once. If coyotenote is still running on that folder, or
the move fails, it keeps using the old folder and says so. Browser drafts kept
under the old folder's path are refiled under the new one.

With an explicit vault, theme preferences stay in that default data directory.
`-data-dir` keeps both notes and settings in the given directory. Only one
Labradorite process can open a vault at a time; a second one is refused.

## Writing

The Labrador logo and a permanent icon rail sit at the left. The logo returns
to the start page; **Notes** shows or hides the adjacent notes panel. Search,
recent notes, new notes, commands, trash and settings stay reachable when that
panel is closed. Desktop and phone remember their own open/closed preference.
Drag rail icons to reorder them within the main shortcuts or bottom utility group;
Alt+Shift+↑/↓ moves a focused icon too. This browser remembers the order.

The note title and folder breadcrumbs sit above the centered menu row. Hover or
focus a truncated title to read its full path. The start page leaves the title
area blank. **File / Edit / View / Insert** stay centered below the title. The
menus remain available on the start page; note-only commands need an open note.
Use ↑/↓ within a menu, ←/→ to switch menus, and Escape to close.

Outline, history, download and trash are grouped with the centered menu. The
pin button sits right after the note title.
A status dot before the note title shows save state; hover for details. It is
hidden on the start page. On phones,
note actions wrap onto their own row within the menu. At home the menu is
centered vertically and horizontally in the header.

The **Write / Markdown / Preview / Split** selector sits at the left end of the
header, beside the logo, and shows the current view (icon only on phones). The
**View** menu and Alt+M switch views too.

**Text formatting** in the left rail opens a panel between Notes and the document.
It groups paragraph styles, bold/italic/strike/code, lists and quotes, inserts,
and undo/redo. It is available in Write, and closes in source or preview modes.
The close button or Escape hides it; this browser remembers the choice separately
for desktop and smaller screens. On smaller screens it opens over the content;
click outside to close. Focus mode temporarily hides it too.

The rail's **Search** button (or Ctrl/⌘ Shift E) opens one query field with
**All notes / This note** scopes. Switching scope keeps the query. Escape clears
the query first, then closes search. All notes searches paths and contents;
This note offers find and replace in the current note.

The interface and writing pane use locally bundled **Lexend**. The writing size
defaults to 18 px, Markdown source to 16 px, and small interface labels and shortcut hints
are at least 12 px.

**Settings** (the button at the bottom of the rail, View → Settings…, Quick
open or Ctrl/⌘ Shift T) holds the theme and, under Writing, text sizes from
14–24 px, Narrow/Standard/Wide line widths for Write and Preview, and spellcheck
in Write. Markdown text stays 2 px smaller than the chosen size. Every change
applies at once and is kept; Done closes the window.
Spelling uses the browser's own language and dictionary. These preferences do
not change the Markdown files or follow the vault to another browser.

- **Write** is a Tiptap WYSIWYG editor. Use the formatting panel or Markdown input rules for
  headings, bold, italic, strike, lists, tasks, quotes, inline/fenced code, links
  and tables. Undo/redo operates on edits, independently of trash restore.
- **Markdown** is CodeMirror with selection, undo, line numbers, syntax colors,
  find, indentation and `[[` note completion. It preserves exact source text,
  including tabs; saving preserves the file's LF or CRLF convention.
- **Preview** is read-only Markdown rendered by Go/Goldmark. External links open
  separately with no referrer. Images from the vault are shown; remote images are
  replaced by their description and never fetched. Raw HTML is not executed.
- **Images:** paste or drop an image into Write or Markdown, or use the formatting panel's
  image button, and it is saved in the vault's `attachments/` folder and linked
  with ordinary Markdown, such as `![photo](attachments/photo.png)`. PNG, JPEG,
  GIF, WebP, AVIF and SVG images up to 20 MiB are accepted; a pasted screenshot is
  named after the moment it was pasted. Image paths are read relative to the note
  first, then to the vault root, as Obsidian does, and Obsidian embeds such as
  `![[photo.png]]` show in Preview.
- **Split** shows source and preview side by side. On narrow screens they stack
  vertically. Each pane scrolls independently.
- **Find and replace** (Edit or Quick open command) searches the open
  note with case, whole-word and regular-expression controls under **Search options**. It opens Markdown
  view from Write or Preview; Split stays split. Replace one match or all,
  then close search to restore the previous writing view. Choosing a view yourself
  during search keeps that choice. Ctrl/⌘+F also opens this panel while the
  Markdown editor has focus. Replacements autosave and can be undone.
- Click the note name to **rename or move** it. `Work/Plan` is `Work/Plan.md`.
  You can also **drag a note** onto a folder, or onto a note in it, to move it
  there; while dragging, a zone at the end of the list moves it out of folders.
  Resolved wiki links in other notes are rewritten to keep pointing at it;
  externally changed files are left alone and reported.
- **Tags** come from a `tags` (or `tag`) property in front matter, as a list or
  comma-separated, and from `#tags` in the text outside code, as in Obsidian; a
  tag needs a letter, so `#2026` is not one. When the vault has tags, click
  **All tags** (#) in the sidebar to see each tag and its note count. Choose a tag
  to filter the note list, or choose All tags inside the list to reset it.
  In Preview, tags are buttons that apply the filter.
- The icons above the notes list open **today's note**, toggle **tags**, and
  **collapse or expand all folders and pins**. **Previous / Next note** follow
  visited-note history. The small button at the far right closes the panel.
- **Pinned notes** sit below tags and above Notes. Use the pin button after the
  note title or the Pin/Unpin command; this section has compact title/date rows and
  remembers whether it is collapsed. **Recently opened** in the rail shows your
  last 30 opened notes. Pins and recents stay in this browser for this vault;
  renaming or moving through the app follows the note's new path.
- Click a folder's name in the sidebar to **collapse** it. Collapsed folders show
  how many notes they hold and stay collapsed in this browser; searching still
  lists their matches. Opening a note deliberately reveals its folder; reloading
  preserves your collapsed folders.
- **Quick open** (Ctrl/⌘+K, or the footer hint) jumps to a note by a few letters of
  its path, such as `qp` for *Quarterly plan*; matched letters are highlighted.
  Start with `#` to jump to a heading of the open note, or `>` to run a command
  such as a view change, rename or theme. Anything typed can also become a
  content search or a new note.
- **Today's note** (File menu, Quick open command, or Alt+J) opens
  `Journal/YYYY-MM-DD` using your computer's local date, creating an empty note
  when it does not exist. Repeating the command keeps the same note and its text.
- **Templates:** keep reusable notes in a `Templates/` folder. The New note
  dialog's **Start with** menu offers these notes, including subfolders, or a
  blank note. Creating a note copies the selected template's current Markdown,
  including properties, and leaves the original template untouched. Templates
  are ordinary notes; edit them in the same way as any other note.
- The **outline** button (Alt+O) lists the note's headings beside the text,
  indented by level. Click one to bring it into view in any view; the outline
  marks the section you are reading as you scroll. It stays open across reloads
  on wide screens and slides over the text on narrow ones.
- **Search notes** (the rail search icon or Ctrl/⌘ Shift E) matches **paths and note contents** and reveals
  the notes sidebar when you use it. The sort
  menu beside the note count orders notes within each folder by recently edited
  (default), title A–Z or title Z–A, and remembers the choice in this browser.
  **Alt+Up / Alt+Down** (or View → Previous / Next note) cycles the visible sorted notes; the sidebar arrows move backward and forward
  through visited notes. The backlink count in the footer lists notes
  linking here. Hidden folders and symlinks are skipped.
- **Settings → Appearance → Theme** opens a list of all **14 palettes**, including the four Catppuccin
  flavors, Ayu, Nord, Tokyo Night, Dracula and Gruvbox. Labradorite Light/Dark use
  neutral white/charcoal surfaces and blue accents. Hover, focus or ↑/↓ previews a
  theme; Enter/click keeps it; closing the window without choosing restores the
  kept theme. Palettes stay as
  published; where one of their text colors would fall below WCAG AA contrast (as in
  Ayu Light or Nord), the app darkens or lightens just that text until it passes.
- **View → Focus mode** (Ctrl/⌘ Shift F) hides the sidebar. Small screens get a slide-out notes drawer,
  a scrollable formatting toolbar, stacked split panes and compact status hints.

### WYSIWYG round trips

Merely opening Write or switching views **does not save or normalize a note**.
After an actual WYSIWYG edit, Markdown is serialized by Tiptap. List marker styles,
blank lines, emphasis markers and table spacing can be normalized; this is expected.

Wiki links such as `[[Note]]`, `[[Folder/Note#Heading|label]]` are preserved by a
custom Markdown node. Click a rendered wiki link to follow it; use the formatting panel to
insert one, or finish typing `[[a note]]`. The source editor suggests existing notes
while typing `[[`. Missing notes can be created from a link.

**Front matter** (a YAML `---` or TOML `+++` block opening the note) shows in
Write as an editable **Properties** box above the text. Write edits only the text
below it, so untouched front matter is saved byte for byte; edited properties keep
the block's delimiter and byte order mark. "Add properties" in Quick open starts
front matter with a `tags` field. Preview shows front matter as a properties
block above the text, and note excerpts and word counts leave it out.

Write deliberately falls back to Markdown for unclosed front matter,
footnotes, reference-style link definitions, raw HTML, `![[…]]` embeds and named
HTML entities such as `&copy;`. This keeps syntax that the rich editor cannot
round-trip intact, including when a browser draft is restored; a short message says
which syntax kept the note in Markdown. Use source mode for
exact whitespace or Markdown dialects beyond GFM. Math rendering and collaborative
editing are not supported.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Alt+N or Ctrl/⌘+N | Create a note |
| Alt+J | Open or create today's journal note |
| Alt+K or Ctrl/⌘+K | Quick open a note, heading or command |
| Alt+S or Ctrl/⌘+Shift+E | Search note contents |
| Ctrl/⌘+S | Save immediately |
| Alt+M or Ctrl/⌘+Shift+M | Cycle Write → Markdown → Preview → Split |
| Alt+T or Ctrl/⌘+Shift+T | Settings: theme and writing |
| Ctrl/⌘+Shift+F | Toggle focus mode |
| Alt+O | Show or hide the outline |
| Ctrl/⌘+Shift+R | Rename or move |
| Ctrl/⌘+Shift+D | Move to trash, with confirmation |
| Alt+Up / Alt+Down | Previous / next note |
| Ctrl/⌘+B / I | Bold / italic in Write |
| Ctrl/⌘+Alt+0–6 | Normal text / heading level in Write |
| Ctrl/⌘+Z / Shift+Z | Undo / redo edits |
| F1 or the footer “Shortcuts” button | All shortcuts |
| Escape | Close a dialog, drawer or narrow-screen outline |

Browsers and operating systems reserve some combinations. Ctrl+T/P/R/W and the
usual copy/cut/paste/undo behavior stay with the browser and editor. On macOS,
Option combinations can enter characters; use Command shortcuts or the visible
controls.

## Autosave, recovery and multiple tabs

Edits autosave **400 ms** after typing stops, through a same-directory temporary
file, fsync, atomic replacement and directory sync. Navigating to another note,
renaming, trashing and downloading flush edits first. The header reports saving,
saved and failed states. Save requests are serialized so an older response cannot
overwrite a newer local edit.

Each tab also records a local browser draft as you type. After an interrupted
request, reload or server disconnect, a banner offers **Restore draft** or
**Discard draft**. Editing is paused until you choose, so opening the disk version
cannot accidentally erase a pending draft. If browser storage is unavailable/full,
a persistent message tells you to keep the tab open until its file is saved.
When a note with an unsaved draft is renamed or deleted outside the app, a banner
says so and **Review drafts** lists such drafts: save one as a note under its old
name, download it, or discard it.

Saves include a hash of the disk revision originally loaded. Another tab or an
external program changing the file produces a **conflict**, with no overwrite.
Restoring an old browser draft keeps its original revision, so it also cannot
silently overwrite a newer file. **Compare versions** shows your edits and the disk
version side by side with changed lines marked; keep either one. **Download edits**
and **Save recovery copy** preserve your edits first, and **Reload from disk**
requires confirmation. There is no automatic merge.

**Note history** (the clock button, or "Show note history" in Quick open) lists
earlier versions of the open note. Before a save replaces a note's text, the
replaced text is kept as a version: at most every 10 minutes while you type, and
always when the file was changed outside the app since Labradorite last wrote it.
The dialog shows each version with the lines that differ from the current text
marked; **Restore this version** brings it back and keeps the text it replaces as
another version. Versions live in the vault's hidden `.history/` folder (up to 50
per note), follow a note when it is renamed, and are plain Markdown files.

Recovery copies use `.recovery-*.md` in the vault, with a temporary-directory
fallback when the vault cannot be written; the UI shows the path. Recovery and
`.pending-*` files are never promoted over a note automatically. Use the same
browser and localhost URL (including host and port) when recovering a draft;
browser storage is origin-specific. Do not clear browser storage while relying on
an unsaved draft.

Deletion moves files into `.trash/` with folder paths preserved. The **Undo** toast
restores the latest deletion during this session; it refuses to replace an
existing file. The **Trash** button lists every note in `.trash/` with its last edit
and an excerpt, and restores any of them. Trash is never purged automatically;
**Delete all…** in the Trash dialog permanently deletes every trashed note and
the history kept of it, after a confirmation. Other files in `.trash/` are left
alone.

The app accepts notes up to **10,000 lines and 4 MiB**, with a **1 MiB** rich-editor
paste limit. Invalid UTF-8, control characters, unsafe names and symlinks are
rejected/skipped. Use a local filesystem and back up the vault. Edits made by other
programs or tabs appear within a few seconds while the tab is visible (it checks a
small fingerprint of the vault every 3 seconds), and at once when you return to the
tab, search or open a note; a note with unsaved edits is never replaced.

## Your notes across versions

From 1.0, every 1.x release keeps this format, so you can upgrade by replacing
the binary, go back to an earlier 1.x, or open the same folder in other tools.
A change that needed converting a vault would only come with a 2.0, with notes
on how to move.

What Labradorite stores in a vault:

- **Notes**: `Name.md` or `Folder/Name.md`, UTF-8 Markdown, with your line
  endings. The file name is the title. A note's file changes only when you edit,
  rename, move or trash it; Labradorite adds no headers, IDs or metadata.
- **`.trash/`**: deleted notes, under their names (with a number when a name
  repeats). Nothing is emptied automatically.
- **`.history/<note path>.md/`**: earlier versions of each note, one file per
  version.
- **`attachments/`**: images added from the editor, linked from notes by path.
- **`.lock`**, and after an interrupted write `.pending-*` or `.recovery-*`
  files, which are kept for you to inspect.
- **`theme`**: the chosen theme ID, in the default data folder (or the
  `-data-dir` folder). Theme IDs never change.

Hidden folders are never read as notes, so `.git` or `.obsidian` can share the
folder. In the browser, drafts, view, sort order and collapsed folders keep their
storage keys across versions; drafts belong to the vault's folder path, so move
a vault only after its drafts are saved.

## How it works

The server is Go's standard `net/http` with an `embed.FS` holding
`web/index.html` and `web/assets/`. Vault images are served from `/vault-file`
only to the app's own pages (other sites cannot embed them), only from outside
hidden folders and never through symlinks, with a sandboxing Content Security
Policy so an SVG cannot run scripts. Loopback host checks, same-origin enforcement,
a per-process mutation token and a Content Security Policy protect the local API
from unrelated web pages. Note paths are validated by `internal/vault`, which
reads the current disk content before checking a SHA-256 revision; an HTTP
success follows the completed atomic save.

There is no frontend framework. CodeMirror manages source transactions and
history; Tiptap and ProseMirror manage rich editing, lists, tables, selection and
undo. Markdown is the single persisted format. Rich editing is lazy-loaded as a
local bundle chunk.

Each browser tab has its own draft key under a vault-specific prefix. A tab holds
a Web Lock named after its key, so a duplicated tab or a window opened from it
picks its own key, and a draft written by another open tab is never removed by
discarding or restoring it here. A dialog stays open while its action runs, so
nothing can be edited between the request and its result. A server restart
changes the request token; a rejected request renews it once from `/api/session`
and retries, but only while the server still serves the same vault. A tab opened
for another vault stops saving, keeps its edits for download and asks for a reload.

Theme IDs and names are stable, so saved settings keep working. The 12 named
upstream palettes keep their original color values.

## Development and CI

Only frontend development needs **Node 24+** and npm:

```sh
npm ci
npm run typecheck                   # strict checks for migrated TypeScript
npm run build                       # refresh committed, embedded assets

go vet ./...
go test -race ./...
go build -o bin/labradorite ./cmd/labradorite
python3 scripts/smoke_web.py        # Python 3, standard library only

npx playwright install --with-deps chromium
npm test                            # real browser tests
```

If Chromium is already installed, point the tests at it:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test
```

Editing `web/src/` requires `npm run build` **then** rebuilding the Go binary.
Refresh the browser afterwards. All browser app sources under `web/src/` use
strict TypeScript, including both editor adapters, API contracts, shared state,
draft recovery and UI controls. `npm run typecheck` checks every app module in
CI; JavaScript sources are not enabled in the TypeScript project. esbuild starts
at `web/src/app.ts` and strips types when producing the committed browser bundle.
The `.js` import specifiers resolve to `.ts` sources during checking and bundling.
The browser still receives JavaScript. Go remains the server and vault backend.

Production bundles and npm dependencies are
version-locked; CI checks that the committed bundle is current. Bundled dependency
licenses are included at `/assets/THIRD_PARTY_LICENSES.txt`.

The Linux CI job runs the Go checks, the smoke script (HTTP, persistence, trash,
themes, conflicts and restart recovery) and a packaging dry run. A browser job
rebuilds the assets, verifies the committed output and runs Playwright. A release
archive holds the binary stamped with the release version; there is no hosted
deployment.

## Manual test checklist

1. Build `bin/labradorite` and run it with a temporary vault.
2. Open the printed localhost URL and create a note in Write mode.
3. Use headings, bold, a checklist and a table. Switch to Markdown, Preview and Split.
4. Reload and confirm saved content; try changing the theme and reload again.
5. Create a second note, insert a wiki link, follow it, inspect backlinks and go back.
6. Search note contents, rename/move a note, trash it and use Undo.
7. Open the same note in two tabs side by side. Edit one: within a few seconds the
   other reloads the newer text. A tab that still holds unsaved edits keeps them instead, and
   saving reports a conflict while keeping the first version on disk.
8. Stop the server, type a draft, restart the server, and reload. Restore the draft,
   then save; no draft should silently replace a newer disk revision.
9. Narrow the browser: notes become a drawer and Split stacks vertically.
10. Use the Trash button to restore an older deletion.

[MIT](../LICENSE). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the
generated browser dependency license bundle for upstream attributions.
