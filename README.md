# coyotenote

A small, local-first Markdown notebook for the terminal. Write without leaving the
keyboard, cycle through notes, and switch between source, rendered preview and a
wide split view. No account, server or runtime network access.

## Build and run

Requires Go 1.24 or newer, Linux or macOS, and a UTF-8 terminal.

```sh
go mod download
go build -o bin/coyotenote .
./bin/coyotenote
# Optional isolated notebook:
./bin/coyotenote -data-dir /tmp/my-notes
```

In this cloud workspace, Go is installed at `/workspace/toolchains/go/bin`:

```sh
export PATH=/workspace/toolchains/go/bin:$PATH
export GOPATH=/workspace/go GOCACHE=/workspace/go-cache
```

## Keys

| Key | Action |
| --- | --- |
| Ctrl+N | Create a note and start writing |
| Ctrl+D | Delete current note; `y` confirms, `n` or Escape cancels |
| Alt+Left / Alt+Right | Previous / next note, wrapping at the ends |
| Ctrl+Left / Ctrl+Right | Alternative note navigation |
| Ctrl+P | Cycle editor → preview → split |
| Ctrl+T | Switch and remember dark/light theme |
| Ctrl+S | Save immediately; retry a failed save |
| Ctrl+Q / Ctrl+C | Save and quit |
| F1 | Show/hide key reference; Escape closes it |
| Arrows, PgUp/PgDn, Home/End | Scroll in preview |

Use your terminal's paste command (bracketed paste); no system clipboard service
is invoked. Normal textarea movement and editing keys work in the editor.
Split view requires 90 columns; narrower terminals show the editor instead.
Switch to preview to scroll independently. Minimum usable size is 32×10; 80×24
is recommended. The header shows the note number and title, derived from the first
nonempty line. Empty notebooks stay empty until Ctrl+N. There is no undo history
in this first version; deletion is permanent after confirmation.

## Files and durability

Default data locations:

- Linux: `$XDG_DATA_HOME/coyotenote`, or `~/.local/share/coyotenote` when unset
  (relative XDG paths are ignored).
- macOS: `~/Library/Application Support/coyotenote`.

Each note is a plain UTF-8 `<timestamp>-<random-id>.md` file; no metadata header or
database is required. Notes are sorted by filename (creation order). `theme` holds
`dark` or `light`; `.lock` prevents simultaneous app instances using the same
notebook. Files are created with mode 0600 and the data directory with 0700.
Markdown preview supports headings, emphasis, lists, code, quotes, links and tables.
It does not fetch links or images. Notes must have fewer than 10,000 lines, a Bubbles
editor limit; oversized or invalid UTF-8 files cause a clear startup error and are
left unchanged. This is a scratchpad, not a large-file editor.

Autosave runs 400 ms after the last edit. Note changes and normal exits flush first.
Each save writes a same-directory temporary file, syncs it, atomically renames it,
and syncs the directory. SIGINT, SIGTERM and SIGHUP request a save and graceful exit.
A failed save keeps the editor dirty and blocks navigation and quitting; correct
the filesystem problem and press Ctrl+S. External changes detected before saving
also block overwrite: preserve your in-memory edits before restarting. Avoid editing
the same note concurrently in other programs; the check is not a filesystem watcher.

A crash or SIGKILL preserves the last committed note; edits still in the debounce
window can be lost. On restart, leftover `.pending-*` files are counted and reported,
never silently promoted over committed notes. Inspect/copy these files manually if
needed, then remove them while the app is closed. They can contain incomplete writes.
The operating system releases the writer lock after a crash. Back up the data
directory normally. Atomic rename and directory-sync guarantees assume a local
filesystem; network filesystems are not supported.

## Development and scope

```sh
go test ./...
go test -race ./...
go vet ./...
go build -o bin/coyotenote .
python3 scripts/smoke.py  # Linux PTY test, after building
```

See [the pre-implementation checklist](docs/behavior.md) for reference findings,
Charm library choices and terminal adaptations of Archnote. The implementation
uses Bubble Tea, Bubbles, Glamour and Lip Gloss; versions and checksums are pinned
in `go.mod` and `go.sum`. Rendering is cached until content, width or theme changes.
There are no attachments, folders, tags, sync, accounts, desktop integration,
global shortcuts or theme detection. Windows is not supported in this version.
