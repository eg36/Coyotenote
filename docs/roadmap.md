# coyotenote roadmap — handoff for implementing agents

_Planned 2026-10-16 from commit `bdb5763`. Co-authored by Claude Opus 5.5 (Claude Code) with eg36.
Written for an agent (e.g. Codex) to implement task by task without further context._

## Implementation status (2026-10-16)

Tasks 1–6b are implemented locally. Optional 6c remains a documented limitation.
Local validation is recorded in `docs/behavior.md`; native Windows console checks,
GitHub CI execution and publishing the first release remain external follow-up.
Bubbles list requires its existing upstream dependency `github.com/sahilm/fuzzy`;
this indirect module and its checksums were added to enable the planned picker.
Undo retains failed restores and reconciles completed moves with directory-sync warnings.

**Target platforms: Linux and Windows.** macOS is out of scope for now: leave the existing
`darwin` code paths alone, but don't test, document or design for them.

Do the tasks in order. Each one is independent enough for its own commit or PR. Earlier tasks
make the later ones safer: CI catches regressions, and Windows support has to exist before
releases can ship a Windows binary.

---

## Conventions (read first)

- **Baseline checks before every commit** (all must pass):
  ```sh
  gofmt -l .            # must print nothing
  go vet ./...
  go test -race -count=1 ./...
  GOOS=windows go build -o /dev/null .
  go build -o bin/coyotenote . && python3 scripts/smoke.py   # Linux only
  ```
- **No new Go modules.** Everything below uses modules already in `go.mod`: Bubbles (`list`,
  `textarea`, `viewport`, `key`), Bubble Tea, Lip Gloss, Glamour, `x/ansi`, `go-colorful`,
  and `golang.org/x/sys` (`unix`, `windows`).
- **Code style:** compact functions, short doc comments explaining *why*, palette colors from
  `paletteFor()`, and badges via `pill()` / `gradient()` in `appearance.go`. Never hard-code colors.
- **Rendering invariant:** every screen cell must have an explicit background. No terminal-default
  holes. `TestAppearanceSurfacesAndResponsiveLayout` enforces this, so new UI must pass it at
  32×10 through 120×40 in both themes. Wrap new UI in `paintBlock`.
- **Durability rules stay intact:** atomic writes via `atomicWrite`, never overwrite a note that
  changed on disk (`store.save` checks), never silently delete user data.
- **Keys:** the textarea already binds `ctrl+a b d e f h k m n p t u v w`. The app overrides
  `ctrl+n d p t` on purpose. Free keys used below: **Ctrl+O** (note picker) and **Ctrl+Z** (undo
  delete). Don't take any other textarea key.
- **Docs:** update `README.md` (keys table, files section) and add a short section to
  `docs/behavior.md` for every user-visible change.
- **Tests:** add regression tests for each task in `app_test.go` / `appearance_test.go`, in the same
  style (`testStore(t)`, `press(m, …)`, `settle(m)` for previews).

---

## Task 1 — GitHub Actions CI

**Why:** every check currently runs only on the developer's machine.

Create `.github/workflows/ci.yml`, triggered on push and pull_request:

| Job | Runner | Steps |
|---|---|---|
| `linux` | `ubuntu-latest` | `actions/setup-go` with `go-version-file: go.mod`; fail if `gofmt -l .` prints anything; `go vet ./...`; `go test -race -count=1 ./...`; `go build -o bin/coyotenote .`; `python3 scripts/smoke.py` |
| `windows` | `windows-latest` | setup-go; `go vet ./...`; `go test -count=1 ./...` (no `-race`: it needs cgo on Windows); `go build -o bin/coyotenote.exe .` |

The Windows job fails on today's code until Task 2 lands. Either merge Tasks 1 and 2 together,
or mark the Windows job `continue-on-error: true` and remove that in Task 2.

**Done when:** both jobs are green on `main`, and a deliberately broken test turns CI red.

---

## Task 2 — Windows support

**Why:** the user runs Windows. Today `dataDir()` refuses Windows and the lock is a stub.

### 2a. Data directory — `store.go` `dataDir()`
- On Windows return `filepath.Join(os.UserConfigDir(), "coyotenote")`, i.e. `%AppData%\coyotenote`.
- Remove the `"this version supports Linux and macOS"` error.
- Linux behavior unchanged. Leave the darwin branch as is.

### 2b. File lock — new `lock_windows.go` (`//go:build windows`)
- `lockFile`: `windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{})`.
- `unlockFile`: `windows.UnlockFileEx(handle, 0, 1, 0, &windows.Overlapped{})`.
- Narrow `lock_unsupported.go` to `//go:build !unix && !windows` and fix its comment, which
  still says "Linux and macOS".

### 2c. Directory sync and rename — `store.go`
- `syncDir`: opening and syncing a directory fails on Windows. Move it into platform files:
  the Unix version stays as it is, the Windows version is a no-op (NTFS rename durability is the
  best available there).
- `atomicWrite`: `os.Rename` replaces existing files on Windows, but it fails with
  `ERROR_ACCESS_DENIED` / `ERROR_SHARING_VIOLATION` while antivirus or the search indexer briefly
  holds the target. On Windows only, retry the rename up to 5 times with 20→320 ms backoff
  before returning the error. Keep the loop in a small platform helper `renameReplace(old, new)`.

### 2d. Paste limit on Windows — `ui.go`
- Bubble Tea on Windows may deliver a paste as ordinary key events, without `Paste: true`, so the
  existing paste check can be bypassed and the textarea silently truncates at `maxLines`.
- Add a general guard: after `m.editor.Update`, if the line count reached `maxLines`, set the
  status to `"Note reached the 10,000-line limit; extra lines were not added"`. This works on
  every platform.

### 2e. Signals — `main.go`
- `os.Interrupt`/SIGTERM handling stays. Go delivers Windows console close, logoff and shutdown
  events as `syscall.SIGTERM`, so the existing `exitMsg` recovery path covers closing the
  terminal window. Verify manually (see below). No code change is expected.

### 2f. Tests — make the suite pass on Windows
- `TestRecoveryFallsBackToTempDir`: `chmod 0500` doesn't block writes on Windows. Skip it when
  `runtime.GOOS == "windows"`.
- `TestSkipUnsafeFilesWithoutChangingThem`: `os.Symlink` needs privileges on Windows. If
  `Symlink` fails, skip only the symlink part.
- `TestLockThemeExitAndAtomicSave` already checks that a second `openStore` is refused, which
  exercises the new Windows lock.
- `TestDataDirectory`: add a Windows branch that checks the path ends in `coyotenote` under
  `os.UserConfigDir()`.

### 2g. Docs
- README: change "Requires … Linux or macOS" to Linux and Windows. Add Windows build
  (`go build -o bin\coyotenote.exe .`), the data location `%AppData%\coyotenote`, and a note
  recommending Windows Terminal (truecolor, Alt-key support). Old `conhost` works with
  fewer colors.
- Smoke test stays Linux-only (it uses a PTY). Say so in its docstring.

**Manual Windows check (in Windows Terminal):** create, edit and wait for autosave; Ctrl+P
preview and split; Ctrl+T theme; Alt+↑/↓ between notes; close the terminal **window** with
unsaved edits and confirm they were saved (or a recovery copy exists) on reopen; start a second
instance and confirm the "open in another coyotenote instance" error.

---

## Task 3 — Release workflow (after Task 2)

Create `.github/workflows/release.yml`, triggered on tags `v*`:
- Matrix: `linux/amd64`, `linux/arm64`, `windows/amd64`, `windows/arm64`; `CGO_ENABLED=0`.
- Build with `go build -trimpath -ldflags "-s -w -X main.version=${GITHUB_REF_NAME}" -o coyotenote[.exe] .`
- Package as `coyotenote_<ver>_<os>_<arch>.tar.gz` (Linux) or `.zip` (Windows), with
  `README.md` and `LICENSE` if present.
- Write `SHA256SUMS`, then `gh release create "$GITHUB_REF_NAME" --generate-notes <files>`.
- `permissions: contents: write`.
- README: add a "Download" section pointing at GitHub Releases.

**Done when:** pushing tag `v0.1.0` produces a release with 4 archives plus checksums, and
`coyotenote --version` prints `coyotenote v0.1.0`.

---

## Task 4 — Trash and undo delete

**Why:** the README says "deletion is permanent after confirmation", and there's no undo.

### Store — `store.go`
- `trash(n note) error`: verify the on-disk body equals `n.Body`, exactly like `remove` does
  (refuse if it changed). Then `os.MkdirAll(dir/.trash, 0700)` and rename `dir/<id>.md` to
  `dir/.trash/<id>.md` (use `renameReplace` on Windows). Then `syncDir` both directories.
- `restore(id string) (note, error)`: rename back if `dir/<id>.md` doesn't exist (refuse if it
  does), read and return it.
- `load()` already skips directories, so `.trash/` is invisible to the notebook. Add a test
  for that.
- Keep `remove` for tests or delete it if unused. Nothing in the UI deletes permanently any more.

### UI — `ui.go`
- The delete confirmation (`y`) calls `trash` instead of `remove`. The status becomes
  `"Moved to trash · Ctrl+Z undo"`.
- `model.trashed []string` is a session stack of trashed IDs. **Ctrl+Z** (new `keys.undo`,
  `binding("ctrl+z")`) pops the last one, calls `restore`, inserts the note in ID order (notes are
  sorted by ID), selects it, and runs `loadNote()` + `requestRender()`. With an empty stack,
  Ctrl+Z falls through to the editor (the textarea has no Ctrl+Z binding, so it's a no-op).
- `confirm` prompt text: "Move this note to trash?". Update the pill colors in `View()`.
- The `statusLine` "Deleted" case becomes a match on the new message (muted text, as today).

### Docs
- README "Files and durability": deleted notes go to `.trash/`. Undo works for the current
  session; afterwards, restore by moving the file back while the app is closed. The trash is
  never emptied automatically.
- Help screen (`helpView`) and footer: add `^Z undo` at rank 0, so it's the first hint dropped.

### Tests
- Trash moves the file and `load()` doesn't list it.
- Ctrl+Z restores content and position.
- Undo stack order across two deletes.
- Trashing a note changed on disk is refused and the file stays.
- Restore is refused if the destination exists.

---

## Task 5 — Note picker with search (Ctrl+O)

**Why:** Alt+↑/↓ is the only way to move between notes, which doesn't scale past a handful.

### Behavior
- **Ctrl+O** opens a full-body overlay listing all notes, with the current one selected.
  Typing filters immediately (no `/` needed). ↑/↓ moves, **Enter** opens, **Esc** closes.
- Each item shows the title (`title(body)`) and a dim description: the first non-heading
  non-empty line, truncated, plus the word count.
- The filter matches titles fuzzily. It also matches note bodies case-insensitively by
  substring; title matches rank first.

### Implementation
- New file `picker.go`. Use `github.com/charmbracelet/bubbles/list` (already in the Bubbles
  module).
  - The item type implements `list.DefaultItem`: `Title()`, `Description()`, and `FilterValue()`
    returning the title.
  - `list.New(items, delegate, w, h)`. Then `SetShowHelp(false)`, `SetShowStatusBar(true)`,
    `SetFilteringEnabled(true)`, and on open `SetFilterState(list.Filtering)` so typing filters
    at once.
  - Custom `Filter`: run `list.DefaultFilter` on titles, then append substring hits from bodies
    that aren't already included, with an empty `MatchedIndexes`. Build the body targets
    lowercased when the picker opens, not on every keystroke.
  - Style the delegate and list from the palette: selected item gets an accent left border plus
    bold accent title, normal titles in `p.text`, descriptions in `p.muted`, filter prompt
    `gradient("Find ", …)`, title bar hidden or a `gradient("NOTES", …)`. Give every style an
    explicit `Background(p.surface)` so the rendering invariant holds.
- In `model`, add `picker *list.Model` (nil when closed). In `Update`:
  - When the picker is open, route all keys to it except Ctrl+Q (quit still works).
  - **Enter** on an item: `m.flush()`. If that fails, keep the picker open and show the error.
    Otherwise set `m.index` to the chosen note, `loadNote()`, close the picker, `requestRender()`.
  - **Esc** closes the picker. If the list is filtering, the first Esc clears the filter (list
    default) and a second Esc closes.
  - `tea.WindowSizeMsg` resizes the open picker (`SetSize(m.width-4, m.height-7)`).
- In `View()`, add `case m.picker != nil:` before the editor cases so the picker replaces the
  body. The pane label reads `☰ NOTES`, and the header mode pill reads `NOTES` in pink.
- Footer: add `^O find` at rank 3, next to `^N`. Help screen: add Ctrl+O.

### Tests
- Opening selects the current note.
- Typing a title fragment filters to it.
- Typing a word that only appears in a body still finds that note.
- Enter switches notes and closes.
- Esc closes without switching.
- Enter while the current note has a failed save keeps the picker open.
- The appearance test covers the picker at all sizes and themes (no default-background cells).

---

## Task 6 — Polish (smaller, independent)

### 6a. Split preview follows the cursor
- In split mode, after each editor update and after `renderedMsg`, scroll the preview
  proportionally:
  `ratio = editor.Line() / max(1, lineCount-1)`, then
  `preview.SetYOffset(int(ratio * float64(max(0, preview.TotalLineCount()-preview.Height))))`.
- Only in split mode. Preview mode keeps manual scrolling.
- Test: in a long note, moving the cursor to the end scrolls the preview near its bottom.

### 6b. More Markdown highlighting in the editor — `appearance.go`
- Generalize `colorHeadings` into `colorMarkdown(view, p)`, keeping the same per-display-line
  approach:
  - List markers (`^\s*([-*+]|\d+\.)\s`): color just the marker in `p.accent`.
  - Blockquotes (`^\s*>`): the whole line in `p.muted`, italic.
  - Inline `` `code` `` and `**bold**`: color the matched spans. Map stripped-text columns back
    to the ANSI string with `ansi.Cut(line, start, end)` and rebuild it as
    prefix + colored span + suffix. Mind the cursor cell inside a span: test with the cursor on,
    and next to, the markers.
- Fenced code blocks need state from lines above the viewport, which the textarea doesn't
  expose. **Skip** them and say so in a comment.
- Tests: like `TestEditorHeadingColors`, one case per construct, plus a plain line that must
  stay uncolored.

### 6c. Wrapped headings — optional, may skip
- Today only the first display row of a soft-wrapped heading is colored. Fixing it needs the
  display-row → logical-line mapping, which the textarea keeps private. Only attempt it if it
  can be derived reliably, e.g. by re-wrapping `editor.Value()` with the same width and word-wrap
  rule and the textarea's scroll offset. Otherwise leave it documented as a known limitation.

---

## Out of scope (for now)
macOS testing and packaging, sync, accounts, attachments, tags/folders, external file watching,
and automatic trash emptying.
