# coyotenote — review findings and task list

_Audit date: 2026-10-16. Co-authored by Claude Opus 5.5 (Claude Code) with eg36.
Written as a handoff for later agents: each task lists the problem, where it is, and the fix._

## Status
All tasks 1–6 below are implemented on branch `review-fixes` (see the commit after this file's
first commit). Regression tests cover each one; `go test -race`, `go vet`, Windows/macOS cross-builds
and `scripts/smoke.py` pass.

## Context
Codex left the "Claude review fixes" unfinished. Its in-progress edits (store.go, lock_unix.go,
lock_unsupported.go) exist only in the cloud workspace — **none of them are in this local checkout**
(HEAD = af82692, clean except an untracked root binary `coyotenote`). This plan is based on a fresh,
read-only audit of the local tree.

## Test results (no repo files changed; builds went to scratchpad)
| Check | Result |
|---|---|
| `go test ./...` | PASS (77.3% coverage) |
| `go test -race ./...` | PASS |
| `go vet`, `gofmt -l` | clean |
| `GOOS=darwin go build` | OK |
| `GOOS=windows go build` | **FAIL** — `unix.Flock` undefined (store.go:50,56) |
| `scripts/smoke.py` | **FAIL** "process did not quit" — harness bug: `reap()` doesn't drain the PTY, so exit output blocks. Passes once draining is added. |
| `--version` | not implemented |

## Task list (in priority order)

### 1. Recovery copies + safe exit after save failure (store.go, ui.go, main.go)
- Today: a failed save (read-only disk, external edit conflict) blocks Ctrl+Q **and** SIGTERM/SIGHUP forever (ui.go:169-184). On SIGHUP the process hangs holding the lock; the only way out is `kill -9`, which loses the edits.
- Add `store.writeRecovery(n, body)` that writes `.recovery-<id>-<timestamp>.md` (0600, via `atomicWrite`) and falls back to `os.TempDir()` if the data dir isn't writable.
- When `flush()` fails: write a recovery copy and show its path in the status line. A second Ctrl+Q (or any signal-driven `exitMsg`) then quits once the recovery copy exists.
- `load()` should ignore `.recovery-*` files and report them the same way it reports `.pending-*` orphans.
- Move the lock into `lock_unix.go` (`//go:build unix`, flock) and `lock_unsupported.go` (returns an error) so the Windows build compiles. This is what Codex had started.

### 2. Debounced, asynchronous preview rendering (ui.go)
- Today `View()` calls `render()` (ui.go:299,302). It builds a new Glamour renderer on every keystroke in split mode, synchronously, and `View` mutates state (status, renderKey). The renderKey also copies the whole note body each frame.
- Change: when the text changes, schedule a `renderMsg{rev}` tick (~150 ms). On that tick, run a `tea.Cmd` that renders `(body, theme, width)` off the update loop and returns `renderedMsg{rev, out, err}`. Apply the result only if `rev` still matches. Theme or width changes trigger a render immediately. `View()` only shows the cached output.
- Optional: cache one Glamour renderer per (theme, width).

### 3. Input limits and invalid note files (ui.go, store.go)
- **Oversized paste:** the textarea silently cuts input at 10,000 lines (`maxLines` in bubbles textarea), so a large paste is lost without any message. In `Update`, before passing a `KeyMsg` with `Paste` to the editor, reject it if the result would exceed the limit (lines, plus a byte cap such as 1 MiB), and show a status warning.
- **Invalid files:** `load()` currently stops startup completely when it finds one bad `.md` file (invalid UTF-8, too many lines, symlink, read error). Change it to skip that file and return a list of warnings, show "N files skipped: …" in the status line, and leave the files untouched.
- Share one limit constant between `load()` and the paste check.

### 4. Cursor, theme file, keybindings (ui.go)
- **Cursor:** `loadNote` runs `SetValue` and then `CursorStart()`, which leaves the cursor at the start of the *last* line. Fix by moving up until `Line()==0`, then calling `CursorStart()`.
- **Theme file:** `string(b) == "light"` (ui.go:54) doesn't match a file containing `light\n`. Use `strings.TrimSpace`.
- **Word navigation:** note navigation is bound to `alt+left/right` and `ctrl+left/right` (ui.go:25). That overrides the textarea's WordBackward/WordForward (`alt+left/right`). Move note navigation to `ctrl+pgup/ctrl+pgdn` (or `alt+[`/`alt+]`), add `ctrl+left/right` to the editor's word keymap, and update the help text, footer hint, README and the appearance test (which looks for "Alt+←/→").
- Decision: note navigation uses `alt+up/alt+down`, with `ctrl+pgup/ctrl+pgdown` as alternates. The textarea doesn't bind any of these.

### 5. Regression tests + `--version` (app_test.go, main.go, scripts/smoke.py)
- `--version`: `var version = "dev"` (set with `-ldflags "-X main.version=…"`), with a fallback to `debug.ReadBuildInfo()`. Print it and exit 0.
- New tests:
  - a failed save writes a recovery file and the second quit exits
  - a signal exit while a save is failing writes a recovery copy
  - an oversized paste is rejected and the editor is unchanged
  - a bad file is skipped with a warning while valid notes still load (this replaces `TestRefuseUnsafeInputWithoutChangingFiles`)
  - the cursor is at line 0, col 0 after a note loads
  - `"light\n"` in the theme file sets the light theme
  - `alt+left` moves by word and doesn't switch notes
  - a stale `renderedMsg` is ignored
  - `--version` output
- Fix `smoke.py` `reap()` so it drains the PTY.

### 6. Housekeeping (small)
- Delete the untracked root binary `coyotenote` and add `/coyotenote` to `.gitignore`.
- README: remove the cloud-only `/workspace/toolchains` section, and document recovery files, skipped files, the new keys and `--version`. Update docs/behavior.md to match.

## Verification
`go test -race ./...`, `go vet ./...`, `GOOS=windows go build ./...` (must compile), `GOOS=darwin go build`,
`go build -o bin/coyotenote . && python3 scripts/smoke.py`. For the failure path, test by hand: `chmod 500` the data dir, edit, Ctrl+Q twice, and confirm a recovery file appears in TMPDIR.
