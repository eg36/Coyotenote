# coyotenote guide

A local-first writing space in your browser, powered by Go. Notes are plain
Markdown files in a folder you choose. The app offers a WYSIWYG editor, Markdown
source, rendered preview, split view, body search, focus mode, 14 themes and
browser draft recovery.

**coyotenote is experimental** AI-made software, built with Claude and Codex.
Keep important notes backed up and try it on a copy of your vault first.

## Run it

Release archives on the [Releases](https://github.com/eg36/Coyotenote/releases)
page hold the `coyotenote` binary for Linux, macOS and Windows, on amd64 and
arm64; run it from the unpacked folder. Only Linux amd64 is tested in CI. macOS
may refuse the unsigned binary until you run `xattr -d com.apple.quarantine
coyotenote` in its folder. To build it
instead, Go **1.26+** is the only requirement. Browser assets are bundled and
committed: Node and npm are **not** needed to run the app, and there are no CDNs
or runtime third-party requests.

```sh
git clone git@github.com:eg36/Coyotenote.git
cd Coyotenote
go build -o bin/coyotenote ./cmd/coyotenote
./bin/coyotenote
```

The app opens **http://127.0.0.1:4280** in your default browser; a current
Chrome/Chromium, Firefox or Safari works. The terminal prints the address and
vault path too. Keep that process running while
using the app; Ctrl+C stops it. There is no account, cloud sync, telemetry,
database or remote access mode.

**Install it as an app:** Chrome and Edge offer *Install coyotenote* in the
address bar or menu. The installed app opens in its own window with the
coyotenote icon; it still needs `coyotenote` running to work.

### Choose a vault

```sh
./bin/coyotenote ~/Notes                  # open an existing Markdown vault
./bin/coyotenote -data-dir /tmp/test      # isolated notes AND theme settings
./bin/coyotenote -listen 127.0.0.1:4390   # choose another local port
./bin/coyotenote -no-browser              # print the address without opening it
./bin/coyotenote -version
```

Flags go **before** the optional vault path. The app only accepts loopback
listeners; it cannot be exposed on `0.0.0.0`, a LAN IP or a public host. Browser
and server must be on the same computer. This is not a hosted multi-user service.

The default vault is:

- Linux: `$XDG_DATA_HOME/coyotenote-web`, or `~/.local/share/coyotenote-web`.
- macOS: `~/Library/Application Support/coyotenote-web` (not verified on a Mac).
- Windows: `%AppData%\coyotenote-web` (not tested).

With an explicit vault, theme preferences stay in that default data directory.
`-data-dir` keeps both notes and settings in the given directory. Only one
coyotenote process can open a vault at a time; a second one is refused.

## Writing

The interface and writing pane use locally bundled **Lexend**. The writing size
is 18 px, Markdown source is 16 px, and small interface labels and shortcut hints
are at least 12 px.

- **Write** is a Tiptap WYSIWYG editor. Use the toolbar or Markdown input rules for
  headings, bold, italic, strike, lists, tasks, quotes, inline/fenced code, links
  and tables. Undo/redo operates on edits, independently of trash restore.
- **Markdown** is CodeMirror with selection, undo, line numbers, syntax colors,
  find, indentation and `[[` note completion. It preserves exact source text,
  including tabs; saving preserves the file's LF or CRLF convention.
- **Preview** is read-only Markdown rendered by Go/Goldmark. External links open
  separately with no referrer. Images from the vault are shown; remote images are
  replaced by their description and never fetched. Raw HTML is not executed.
- **Images:** paste or drop an image into Write or Markdown, or use the toolbar's
  image button, and it is saved in the vault's `attachments/` folder and linked
  with ordinary Markdown, such as `![photo](attachments/photo.png)`. PNG, JPEG,
  GIF, WebP, AVIF and SVG images up to 20 MiB are accepted; a pasted screenshot is
  named after the moment it was pasted. Image paths are read relative to the note
  first, then to the vault root, as Obsidian does, and Obsidian embeds such as
  `![[photo.png]]` show in Preview.
- **Split** shows source and preview side by side. On narrow screens they stack
  vertically. Each pane scrolls independently.
- Click the note name to **rename or move** it. `Work/Plan` is `Work/Plan.md`.
  You can also **drag a note** onto a folder, or onto a note in it, to move it
  there; while dragging, a zone at the end of the list moves it out of folders.
  Resolved wiki links in other notes are rewritten to keep pointing at it;
  externally changed files are left alone and reported.
- **Tags** come from a `tags` (or `tag`) property in front matter, as a list or
  comma-separated, and from `#tags` in the text outside code, as in Obsidian; a
  tag needs a letter, so `#2026` is not one. When the vault has tags, a menu under
  the search box filters the note list by one, showing how many notes carry each.
  In Preview, tags are buttons that apply the filter.
- Click a folder's name in the sidebar to **collapse** it. Collapsed folders show
  how many notes they hold and stay collapsed in this browser; searching still
  lists their matches, and opening a note inside one expands it.
- **Quick open** (Ctrl/⌘+K, or the footer hint) jumps to a note by a few letters of
  its path, such as `qp` for *Quarterly plan*; matched letters are highlighted.
  Start with `#` to jump to a heading of the open note, or `>` to run a command
  such as a view change, rename or theme. Anything typed can also become a
  content search or a new note.
- The **outline** button (Alt+O) lists the note's headings beside the text,
  indented by level. Click one to bring it into view in any view; the outline
  marks the section you are reading as you scroll. It stays open across reloads
  on wide screens and slides over the text on narrow ones.
- **Search notes** in the sidebar matches **paths and note contents**. The sort
  menu beside the note count orders notes within each folder by recently edited
  (default), title A–Z or title Z–A, and remembers the choice in this browser.
  **Alt+Up / Alt+Down** cycles the visible sorted notes; the back arrow returns
  from linked-note navigation. The backlink count in the footer lists notes
  linking here. Hidden folders and symlinks are skipped.
- Click the theme name for all **14 palettes**, including the four Catppuccin
  flavors, Ayu, Nord, Tokyo Night, Dracula and Gruvbox. Coyote Light/Dark use
  neutral white/charcoal surfaces and blue accents. Hover, focus or ↑/↓ previews a
  theme; Enter/click keeps it; Escape restores the previous theme.
- The focus button hides the sidebar. Small screens get a slide-out notes drawer,
  a scrollable formatting toolbar, stacked split panes and compact status hints.

### WYSIWYG round trips

Merely opening Write or switching views **does not save or normalize a note**.
After an actual WYSIWYG edit, Markdown is serialized by Tiptap. List marker styles,
blank lines, emphasis markers and table spacing can be normalized; this is expected.

Wiki links such as `[[Note]]`, `[[Folder/Note#Heading|label]]` are preserved by a
custom Markdown node. Click a rendered wiki link to follow it; use the toolbar to
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
round-trip intact, including when a browser draft is restored. Use source mode for
exact whitespace or Markdown dialects beyond GFM. Math rendering and collaborative
editing are not supported.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Alt+N or Ctrl/⌘+N | Create a note |
| Alt+K or Ctrl/⌘+K | Quick open a note, heading or command |
| Alt+S or Ctrl/⌘+Shift+E | Search note contents |
| Ctrl/⌘+S | Save immediately |
| Alt+M or Ctrl/⌘+Shift+M | Cycle Write → Markdown → Preview → Split |
| Alt+T or Ctrl/⌘+Shift+T | Choose a theme |
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
always when the file was changed outside the app since coyotenote last wrote it.
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
and an excerpt, and restores any of them. Trash is never purged automatically.

The app accepts notes up to **10,000 lines and 4 MiB**, with a **1 MiB** rich-editor
paste limit. Invalid UTF-8, control characters, unsafe names and symlinks are
rejected/skipped. Use a local filesystem and back up the vault. External filesystem
edits are picked up when you return to the tab, search or open a note; a note with
unsaved edits is never replaced. Files are not watched live.

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
npm run build                       # refresh committed, embedded assets

go vet ./...
go test -race ./...
go build -o bin/coyotenote ./cmd/coyotenote
python3 scripts/smoke_web.py        # Python 3, standard library only

npx playwright install --with-deps chromium
npm test                            # real browser tests
```

If Chromium is already installed, point the tests at it:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test
```

Editing `web/src/` requires `npm run build` **then** rebuilding the Go binary.
Refresh the browser afterwards. Production bundles and npm dependencies are
version-locked; CI checks that the committed bundle is current. Bundled dependency
licenses are included at `/assets/THIRD_PARTY_LICENSES.txt`.

The Linux CI job runs the Go checks, the smoke script (HTTP, persistence, trash,
themes, conflicts and restart recovery) and a packaging dry run. A browser job
rebuilds the assets, verifies the committed output and runs Playwright. A release
archive holds the binary stamped with the release version; there is no hosted
deployment.

## Manual test checklist

1. Build `bin/coyotenote` and run it with a temporary vault.
2. Open the printed localhost URL and create a note in Write mode.
3. Use headings, bold, a checklist and a table. Switch to Markdown, Preview and Split.
4. Reload and confirm saved content; try changing the theme and reload again.
5. Create a second note, insert a wiki link, follow it, inspect backlinks and go back.
6. Search note contents, rename/move a note, trash it and use Undo.
7. Open the same note in two tabs. Edit one, then return to the other: it reloads
   the newer text. A tab that still holds unsaved edits keeps them instead, and
   saving reports a conflict while keeping the first version on disk.
8. Stop the server, type a draft, restart the server, and reload. Restore the draft,
   then save; no draft should silently replace a newer disk revision.
9. Narrow the browser: notes become a drawer and Split stacks vertically.
10. Use the Trash button to restore an older deletion.

[MIT](../LICENSE). See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and the
generated browser dependency license bundle for upstream attributions.
