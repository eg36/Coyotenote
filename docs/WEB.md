# coyotenote web

A local-first writing space in your browser, powered by Go. The notes, vault paths,
wiki links, trash, autosave rules and **all 14 themes** come from the terminal app
on `main`. The web app adds a WYSIWYG editor, Markdown source, rendered preview,
split view, body search, focus mode and browser draft recovery.

**The web app is experimental.** It lives beside the terminal app in this
repository as `cmd/coyotenote-web`. Keep important notes backed up and try it on
a copy of your vault first. Coyotenote is AI-made software, built with Claude and Codex.

## Try it locally

Release archives on the [Releases](https://github.com/eg36/Coyotenote/releases)
page include `coyotenote-web` next to the terminal app; run it from the unpacked
folder. To build it instead, Go **1.26+** is the only requirement. Linux amd64 is
the CI and release target. Browser assets are bundled and committed: Node and npm
are **not** needed to run the app, and there are no CDNs or runtime third-party
requests.

```sh
git clone git@github.com:eg36/Coyotenote.git
cd Coyotenote
go build -o bin/coyotenote-web ./cmd/coyotenote-web
./bin/coyotenote-web
```

Open **http://127.0.0.1:4280** in a current Chrome/Chromium, Firefox or Safari. The
terminal prints the URL and vault path. Chromium on Linux is tested; Firefox and
Safari are not yet verified by CI. Keep that process running while using the
app; Ctrl+C stops it. The binary runs an embedded local HTTP server, not the TUI.
There is no account, cloud sync, telemetry, database or remote access mode.

If the repository is already on your computer:

```sh
git pull --ff-only
go build -o bin/coyotenote-web ./cmd/coyotenote-web
./bin/coyotenote-web -version
./bin/coyotenote-web
```

**Run the same binary you rebuilt:** these commands build and launch
`./bin/coyotenote-web`. An older `./coyotenote` in the repository root is a different
file and may still be the terminal application.

### Choose a vault

```sh
./bin/coyotenote-web ~/Notes                  # open an existing Markdown vault
./bin/coyotenote-web -data-dir /tmp/web-test  # isolated notes AND theme settings
./bin/coyotenote-web -listen 127.0.0.1:4390  # choose another local port
./bin/coyotenote-web -version
```

Flags go **before** the optional vault path. The app only accepts loopback
listeners; it cannot be exposed on `0.0.0.0`, a LAN IP or a public host. Browser and
server must be on the same computer. This is not a hosted multi-user service.

The default vault is **separate from the terminal app**:

- Linux: `$XDG_DATA_HOME/coyotenote-web`, or `~/.local/share/coyotenote-web`.
- macOS: `~/Library/Application Support/coyotenote-web` (not verified on a Mac).
- Windows: `%AppData%\coyotenote-web` (cross-build only; not tested in CI).

With an explicit vault, web theme preferences stay in that default web data
directory. `-data-dir` keeps both notes and settings in the given directory.
Close the terminal app before opening the **same** vault: they share the original
`.lock` mechanism and intentionally refuse simultaneous processes.

## Writing in the browser

The interface and writing pane use locally bundled **Lexend**, matching the
Lexxy site’s font. The writing size is 18 px, Markdown source is 16 px, and small
interface labels and shortcut hints are at least 12 px. No font download is
needed when running the app.

- **Write** is a Tiptap WYSIWYG editor. Use the toolbar or Markdown input rules for
  headings, bold, italic, strike, lists, tasks, quotes, inline/fenced code, links
  and tables. Undo/redo operates on edits, independently of trash restore.
- **Markdown** is CodeMirror with selection, undo, line numbers, syntax colors,
  find, indentation and `[[` note completion. It preserves exact source text,
  including tabs; the Go store preserves the file's LF or CRLF convention.
- **Preview** is read-only Markdown rendered by Go/Goldmark. External links open
  separately with no referrer; images are represented by alt-text placeholders
  and never fetched. Raw HTML is not executed.
- **Split** shows source and preview side by side. On narrow screens they stack
  vertically. Each pane scrolls independently.
- Click the note name to **rename or move** it. `Work/Plan` is `Work/Plan.md`.
  Resolved wiki links in other notes are rewritten using the terminal app's rules;
  externally changed files are left alone and reported.
- **Search notes** in the sidebar matches **paths and note contents**. The sort menu beside the note count orders notes within
  each folder by recently edited (default), title A–Z or title Z–A, and remembers
  the choice in this browser. **Alt+Up / Alt+Down** cycles the visible sorted notes;
  the back arrow returns from linked-note navigation. The backlink count in the
  footer lists notes linking here. Hidden folders and symlinks are skipped just as on `main`.
- Click the theme name for all **14 palettes**, including the four Catppuccin
  flavors, Ayu, Nord, Tokyo Night, Dracula and Gruvbox. Coyote Light/Dark use neutral
  white/charcoal surfaces and blue accents for the web. Hover/focus previews a theme;
  or use ↑/↓ to preview in a compact palette list. Enter/click keeps it; Escape
  restores the previous theme. The picker leaves the background sharp and visible.
  No system theme detection.
- The focus button hides the sidebar. Small screens get a slide-out notes drawer,
  a scrollable formatting toolbar, stacked split panes and compact status hints.

### WYSIWYG round trips

Merely opening Write or switching views **does not save or normalize a note**.
After an actual WYSIWYG edit, Markdown is serialized by Tiptap. List marker styles,
blank lines, emphasis markers and table spacing can be normalized; this is expected.
The filename and `.md` format remain compatible with the terminal app.

Wiki links such as `[[Note]]`, `[[Folder/Note#Heading|label]]` are preserved by a
custom Markdown node. Click a rendered wiki link to follow it; use the toolbar to
insert one, or finish typing `[[a note]]`. The source editor suggests existing notes
while typing `[[`. Missing notes can be created from a link.

Write deliberately falls back to Markdown for front matter (YAML or TOML),
footnotes, reference-style link definitions, raw HTML and image references. This keeps syntax that the rich editor cannot
round-trip intact. Use source mode for exact whitespace or Markdown dialects beyond
GFM. File attachments, embedded media, math rendering and collaborative editing are
not supported.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Alt+N or Ctrl/⌘+N | Create a note |
| Alt+K or Ctrl/⌘+K | Find notes |
| Ctrl/⌘+S | Save immediately |
| Alt+M or Ctrl/⌘+Shift+M | Cycle Write → Markdown → Preview → Split |
| Alt+T or Ctrl/⌘+Shift+T | Choose a theme |
| Ctrl/⌘+Shift+F | Toggle focus mode |
| Ctrl/⌘+Shift+R | Rename or move |
| Ctrl/⌘+Shift+D | Move to trash, with confirmation |
| Alt+Up / Alt+Down | Previous / next note |
| Ctrl/⌘+B / I | Bold / italic in Write |
| Ctrl/⌘+Z / Shift+Z | Undo / redo edits |
| F1 or the footer “Shortcuts” button | All shortcuts |
| Escape | Close a dialog or drawer |

Browsers and operating systems reserve some combinations. Ctrl+T/P/R/W and the
usual copy/cut/paste/undo behavior stay with the browser/editor; the Shift or Alt
alternatives above avoid the terminal app's shortcut conflicts. On macOS, Option
combinations can enter characters; use Command shortcuts or the visible controls.

## Autosave, recovery and multiple tabs

Edits autosave **400 ms** after typing stops. Acknowledged saves use the terminal
app's same-directory temporary file, fsync, atomic replacement and directory sync.
Navigating to another note, renaming, trashing and downloading flush edits first.
The header reports saving, saved and failed states. Save requests are serialized so
an older response cannot overwrite a newer local edit.

Each tab also records a local browser draft as you type. After an interrupted
request, reload or server disconnect, a banner offers **Restore draft** or
**Discard draft**. Editing is paused until you choose, so opening the disk version
cannot accidentally erase a pending draft. If browser storage is unavailable/full,
a persistent message tells you to keep the tab open until its file is saved.

Saves include a hash of the disk revision originally loaded. Another tab or an
external program changing the file produces a **conflict**, with no overwrite.
Restoring an old browser draft keeps its original revision, so it also cannot
silently overwrite a newer file. **Compare versions** shows your edits and the disk
version side by side with changed lines marked; keep either one. **Download edits**
and **Save recovery copy** preserve your edits first, and **Reload from disk**
requires confirmation. There is no automatic merge.

Recovery copies use `.recovery-*.md` in the vault, with a temporary-directory
fallback when the vault cannot be written; the UI shows the path. Recovery and
`.pending-*` files are never promoted over a note automatically. Browser drafts
are scoped by vault and tab, and are removed after that draft is saved/discarded.
Use the same browser and localhost URL (including host and port) when recovering
a draft; browser storage is origin-specific.
Do not clear browser storage while relying on an unsaved draft. Local storage and
the server's data folder remain entirely on your computer.

Deletion moves files into `.trash/` with folder paths preserved. The **Undo** toast
restores the latest deletion during this session; it refuses to replace an
existing file. The **Trash** button lists every note in `.trash/` with its last edit
and an excerpt, and restores any of them. Trash is never purged automatically.

The app accepts notes up to **10,000 lines and 4 MiB**, with a **1 MiB** rich-editor
paste limit. Invalid UTF-8, control characters, unsafe names and symlinks are
rejected/skipped. Use a local filesystem and back up the vault. External filesystem
edits are picked up when you return to the tab, search or open a note; a note with
unsaved edits is never replaced. Files are not watched live.

## Development and CI

Only frontend development needs **Node 24+** and npm:

```sh
npm ci
npm run build                       # refresh committed, embedded assets

go test -race ./...
go vet ./...
go build -o bin/coyotenote-web ./cmd/coyotenote-web
python3 scripts/smoke_web.py             # Python 3, standard library only

npx playwright install --with-deps chromium
npm test                            # real Chromium browser tests
```

If Chromium is already installed, e.g. in the cloud development environment:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test
```

The Go server embeds `web/index.html` and `web/assets/` into one binary. Editing
`web/src/` requires `npm run build` **then** rebuilding the Go binary. Refresh the
browser afterwards. Production bundles and npm dependencies are version-locked;
CI checks that the committed bundle is current. Bundled dependency licenses are
included at `/assets/THIRD_PARTY_LICENSES.txt`.

The shared Linux CI job also builds the web app and runs its smoke script, which
checks HTTP, persistence, trash, themes, conflicts and restart recovery. A browser
job builds the assets and runs Playwright. Each release archive ships both apps,
stamped with the release version; there is no hosted deployment.

## Provenance and architecture

The functional reference is `main` at
[`dcb6a51`](https://github.com/eg36/Coyotenote/commit/dcb6a51c5dbf79efd6859cb506dd736bdc061996).
The vault store, path validation, locking, atomic writes, trash and link
resolution live in `internal/vault`, shared with the terminal app, so both apps
read and write the same files by the same rules. The web app was developed on the
`web_alpha` branch, from an empty initial commit, and later merged with the
terminal app into this repository.
Theme IDs and names are preserved. The 12 named upstream palettes retain their
original color values; Coyote Light/Dark have neutral web surfaces with blue accents.

Go's standard `net/http` is sufficient for a local embedded app; Goldmark supplies
safe GFM preview rendering. CodeMirror provides a source editor, and the open-source
Tiptap/ProseMirror stack supplies selection-aware rich editing and Markdown
serialization. A handwritten `contenteditable` converter would be harder to make
reliable for lists, tables, paste and undo. There is no frontend UI framework or
runtime Node process.

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the generated
browser dependency license bundle for upstream attributions.

## Functional mapping

| Terminal workflow | Browser workflow |
| --- | --- |
| Named Markdown vaults and folders | Same path-based Markdown store and folder groups in sidebar |
| New / rename / trash / restore | Visible controls and confirmation dialogs; Undo toast |
| Note picker, full-text filtering | Sidebar body/path search, keyboard focus shortcut |
| Markdown textarea | CodeMirror source with selection, history, find and completion |
| Glamour preview | Goldmark GFM HTML with raw HTML disabled and images suppressed |
| Editor / preview / split | Markdown / Preview / Split, plus Tiptap Write mode |
| 14 manual themes | Same IDs; neutral blue Coyote themes, 12 unchanged named palettes; compact keyboard preview with cancel |
| Wiki resolution, aliases, heading links, backlinks | Reused parser/resolver; rich wiki node; clickable preview; backlinks dialog |
| 400 ms atomic autosave | Same store with serialized browser saves and hash revision checks |
| Disk recovery copy on failed exit | Browser drafts plus download/recovery-copy actions on save failure |
| Ctrl+C/X/V and platform clipboard helpers | Browser-native editing and clipboard; no clipboard process |
| Terminal app shortcuts | Browser-safe Shift/Alt alternatives plus visible key hints |
| Terminal resizing | Sidebar drawer and vertical split below 530 px |

The rich editor is an enhancement, not a lossless Markdown formatter: it normalizes
source formatting after actual rich edits. Front matter, footnotes, link
definitions, raw HTML and image references keep a note in source mode, including
when a browser draft is restored. Simply opening a note
or switching modes never normalizes its file.

The app does not add hosted access, authentication, sync, attachments, tags,
collaboration, PDF export or a background daemon. It does
not start a browser automatically or install desktop integration.

## Architecture

The server is standard Go net/http with an embed.FS. Loopback host checks,
same-origin enforcement, a per-process mutation token and CSP protect the local
API from unrelated web pages. API data is JSON; note paths are validated with the
original store rules. Requests read the current disk content before checking a
SHA-256 revision. HTTP success follows the completed atomic save.

There is no frontend framework. CodeMirror manages source transactions/history;
Tiptap and ProseMirror manage rich editing, lists, tables, selection and undo.
Markdown is the single persisted format. Rich editing is lazy-loaded as a local
bundle chunk. All dependency assets and licenses are embedded; no runtime CDN,
external font requests or telemetry are used. Lexend is bundled locally under
the SIL Open Font License.

Each browser tab has its own draft key under a vault-specific prefix. A pending
draft blocks editing until restored/discarded and survives additional reloads.
Restoring a draft keeps its original base revision: an old draft cannot overwrite
newer disk content. A server restart changes the request token; a rejected request
renews it once from `/api/session` and retries, but only while the server still
serves the same vault. Refreshing the note list checks the vault too: a tab opened
for another vault stops saving, keeps its edits for download and asks for a reload.

The Linux CI job covers both apps, with an added Chromium job. The release
workflow builds both apps into one archive. The Go/API checks and a
standard-library Python smoke test run without npm; frontend CI rebuilds assets
and verifies the committed output before browser tests.

## Manual test checklist

1. Build `bin/coyotenote-web` from `./cmd/coyotenote-web`, run it with a temporary vault.
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
