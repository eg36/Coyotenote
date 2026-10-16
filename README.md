# coyotenote

A small, local-first Markdown notebook for the terminal. Write without leaving the
keyboard, keep notes in folders of a vault, connect them with `[[wiki links]]`, and
switch between source, rendered preview and a wide split view. No account, server
or runtime network access.

The header carries a gradient title, the note's path, a save indicator
(● Saved, ○ Unsaved, ! Not saved) and a colored mode badge. The footer shows
rainbow key pills with a gradient accent and word count; errors and warnings
appear above the keys only when there is something to read. Markdown headings
are colored by level in both the editor and the Glamour preview (H1 is a badge).
The editor also highlights list markers, blockquotes, inline code, bold spans and `[[links]]`.
Fenced code and continuation rows of wrapped headings have no special editor highlighting.
Both manual themes share one editor/preview surface, and all text stays readable
without color.

## Build and run

Requires Go 1.24 or newer, Linux and Windows, and a UTF-8 terminal.

```sh
go mod download
go build -o bin/coyotenote .
./bin/coyotenote            # notes in the application data directory
./bin/coyotenote ~/Notes    # any folder as a vault (created if missing)
./bin/coyotenote -data-dir /tmp/my-notes   # isolated notes and settings
./bin/coyotenote -migrate ~/Notes          # rename pre-0.2 timestamp files after their titles
./bin/coyotenote -version
```

Release builds can stamp a version: `go build -ldflags "-X main.version=v1.0.0" -o bin/coyotenote .`
Otherwise the module version (or `dev`) is reported.

On Windows, build with `go build -o bin\coyotenote.exe .` and run
`bin\coyotenote.exe`. Windows Terminal is recommended for truecolor and Alt keys;
older console hosts may show fewer colors.

## Download

Download a Linux or Windows archive for amd64 or arm64 from
[GitHub Releases](https://github.com/eg36/coyotenote/releases). Each release includes
`SHA256SUMS` to verify the archives.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+O | Browse the current folder: Enter opens a note or folder, Backspace goes up. Typing searches all paths and bodies; `Folder/` lists exactly the notes below that folder. Escape clears, then closes |
| Ctrl+Z | Undo the latest trash operation in this session |
| Ctrl+N | Create a note: type `Name` or `Folder/Name` (empty: `Untitled`), Enter creates |
| Ctrl+R | Rename or move the note; `[[links]]` to it are updated in other notes |
| Ctrl+G | Open the `[[link]]` under the cursor; a missing note can be created |
| Ctrl+Y | Go back to the note you came from (links, Ctrl+O, Ctrl+L) |
| Ctrl+L | List the notes that link to this one |
| Ctrl+D | Move current note to trash; `y` confirms, `n` or Escape cancels |
| Alt+Up / Alt+Down | Previous / next note, wrapping at the ends |
| Ctrl+PgUp / Ctrl+PgDn | Alternative note navigation |
| Alt+Left/Right, Ctrl+Left/Right | Move by word in the editor |
| Ctrl+P | Cycle editor → preview → split |
| Ctrl+T | Switch and remember dark/light theme |
| Ctrl+S | Save immediately; retry a failed save |
| Ctrl+Q / Ctrl+C | Save and quit (after a failed save: first press writes a recovery copy, second quits) |
| F1 | Show/hide key reference; Escape closes it |
| Arrows, PgUp/PgDn, Home/End | Scroll in preview |

Use your terminal's paste command (bracketed paste); no system clipboard service
is invoked. Pastes over 1 MiB, or that would push a note past 10,000 lines, are
rejected with a status message rather than silently truncated. Normal textarea movement and editing keys work in the editor.
Split view requires 90 columns; narrower terminals show the editor instead.
Split preview follows the cursor proportionally. Switch to preview to scroll independently. Minimum usable size is 32×10; 80×24
is recommended. The header shows the note number and path. Empty notebooks stay empty until Ctrl+N. Deleted notes move to `.trash/`; Ctrl+Z restores them during the current session.

## Vaults, folders and links

A vault is a folder of `.md` files; subfolders hold groups of notes. A note's file
name is its title: `Work/Project X` is `Work/Project X.md`. Hidden folders such as
`.trash`, `.git` and `.obsidian` are ignored, and symlinked folders are not followed,
so the same folder can also be opened in Obsidian. Names may not contain
`< > : " | ? * [ ] # ^` or Windows device names, so a vault works on every platform.

Links use Obsidian syntax: `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading]]` and
`[[Note|shown text]]`. A name resolves to the note with that path, otherwise the note
with that file name, preferring the linking note's folder and then the shortest path.
Links inside code are ignored. Typing `[[` suggests notes: arrows select, Tab or
Enter inserts, Escape hides the list. The preview shows links underlined; links to
missing notes are dimmed. The footer's `← N` counts notes linking here.

Renaming updates every link that pointed at the old name, keeping headings and
aliases. A note changed outside coyotenote is not rewritten; the status lists it.
Notes created before 0.2 have timestamp names. They keep working and show their
first line as the title; `-migrate` renames them after their titles once you
confirm the printed plan.

## Files and durability

Default data locations:

- Linux: `$XDG_DATA_HOME/coyotenote`, or `~/.local/share/coyotenote` when unset
  (relative XDG paths are ignored).
- Windows: `%AppData%\coyotenote`.

Trash is never emptied automatically; `.trash/` at the vault root keeps each note's
folder path. After restarting, restore a trashed note by moving its `.md` file from
`.trash/` back into the vault while the app is closed. Restore refuses to overwrite an existing note. Undo preserves current edits
before switching to the restored note.

Each note is a plain UTF-8 `.md` file; no metadata header or database is required.
Notes are sorted by path, ignoring case. `theme` holds `dark` or `light`; it lives in
the data directory, never in a vault given as an argument. `.lock` in the vault
prevents simultaneous app instances using the same notes. Files are created with mode 0600 and the data directory with 0700.
Markdown preview supports headings, emphasis, lists, code, quotes, links and tables.
It does not fetch links or images. The preview renders in the background shortly
after typing pauses, so large notes never block the editor. Notes may have up to
10,000 lines, a Bubbles editor limit. Oversized, invalid UTF-8, symlinked or
unreadable `.md` files are skipped at startup with a status warning naming them, and
are left unchanged; the rest of the notebook opens normally. This is a scratchpad,
not a large-file editor.

Autosave runs 400 ms after the last edit. Note changes and normal exits flush first.
Each save writes a same-directory temporary file, syncs it, atomically renames it,
and syncs the directory on Unix. Windows retries replacement when a scanner briefly holds the target; directory sync is unavailable there. SIGINT, SIGTERM and SIGHUP request a save and graceful exit.
A failed save keeps the editor dirty and blocks navigation; correct the filesystem
problem and press Ctrl+S. Quitting after a failed save writes the edits to a
`.recovery-<note>-<time>.md` copy in the data directory (or, if that is not
writable, a `coyotenote-recovery-*.md` file in the system temporary directory),
shows its path, and quits on the second Ctrl+Q. SIGINT/SIGTERM/SIGHUP write the
recovery copy and exit immediately, printing its path. Recovery copies are counted
at startup and never merged automatically. External changes detected before saving
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

The implementation uses Bubble Tea, Bubbles, Glamour and Lip Gloss; versions and checksums are pinned
in `go.mod` and `go.sum`. Rendering is cached until content, width or theme changes.
There are no attachments, tags, sync, accounts, desktop integration,
global shortcuts or theme detection. Linux and Windows are the supported platforms.
