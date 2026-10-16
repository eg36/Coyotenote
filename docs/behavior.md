# First-version checklist and reference review

Reviewed before implementation: Archnote README and Svelte event/save handlers;
Omawrite README (focused Markdown writing, debounce and recovery); OmaJot README
and checked-in site documentation (keyboard navigation and preview). The hosted
OmaJot site was blocked by the environment; its public Git repository supplied
the documentation instead.

- [x] Multiple independent notes; first nonempty line supplies the display title.
- [x] Create immediately; confirm deletion; previous/next navigation wraps.
- [x] Focused editor, scrollable rendered Markdown preview, optional wide split.
- [x] Always-visible key hints and expanded help; compact layout for small terminals.
- [x] Debounced autosave (400 ms), explicit save, flush before navigation and exit.
- [x] Plain UTF-8 Markdown files in the standard application data directory.
- [x] Atomic replacement: same-directory temporary file, fsync, rename, directory sync.
- [x] Interrupted writes leave the previous committed note intact. Orphan temporary
      files never replace committed notes automatically. Report them for inspection.
- [x] Explicit dark/light themes, remembered locally; no theme detection.
- [x] Tests cover creation, edits, deletion, navigation, rendering, persistence and recovery.

Archnote defines scope. Its swipe/click navigation maps to keyboard navigation;
Ctrl+W is replaced with Ctrl+D to avoid the editor's word-delete convention.
Tray, pin-to-top, global shortcuts, theme polling and desktop integration have no
terminal equivalent here and are omitted. Two manual themes replace its large
palette. Markdown source replaces its plain-text-only editing.

Omawrite informs the uncluttered writing surface and save feedback. OmaJot informs
note titles, keyboard browsing and preview scrolling; its external editor, hub,
sync, folders, tags and attachments are outside scope.

## Library choices

Bubble Tea provides a serialized model/update loop and terminal lifecycle handling.
Bubbles textarea provides multiline Markdown-source editing; viewport provides
preview scrolling; key provides centralized bindings. Glamour renders Markdown
without a browser. Lip Gloss styles and lays out the terminal. Use the stable v1
APIs, with pinned module versions. No database, web stack, daemon or runtime network
access. Render only when content, theme or width changes, not for cursor movement.

## Reference revisions

- [Archnote](https://github.com/dannymcc/Archnote): `991a76156e6dee0686f1ee65d24dd96527c37132`
- [Omawrite](https://github.com/omacom/omawrite): `a7da0b14e501d6aab5b67258564052727ae1d1d9`
- [OmaJot](https://github.com/renerocksai/omajot): `c7c1ffd082f77f47640990e7c01ed2d3ec6748b4`

Archnote uses a 300 ms save debounce and retains at least one note. Coyotenote
uses 400 ms and allows an empty notebook, with an explicit create prompt.
The implementation uses original code; reference projects were inspected for
behavior only. Glamour brings Markdown/parser and syntax-highlighting transitive
dependencies; this is the main dependency cost, in exchange for maintained terminal
rendering. A Linux development binary is about 16 MB before stripping.

## Validation

Go unit tests, the race detector, `go vet`, and a native build passed. The Python
PTY smoke test exercised actual terminal input, autosave, Markdown preview,
SIGKILL/reopen recovery and SIGTERM flushing. Linux was executed; macOS uses the
same Unix lock/filesystem APIs but has not been exercised on a Mac.

## Terminal polish

Lip Gloss handles explicit shared surfaces, a padded header, pane labels and a
full-height split divider. Bubbles help renders colored shortcut hints from the
actual key bindings. The footer includes a static violet-to-cyan accent and word
count; no animation loop or added module is required. Glamour uses explicit dark
and light styles, aligned document margins, and named Chroma themes so code colors
also change when switching themes. Surface rendering restores background colors
after nested ANSI resets to avoid showing the terminal's default background.

Appearance checks interpret background colors at every displayed cell in both
themes and across terminal sizes. The PTY smoke test also exercises split view,
theme switching and resizing below the split threshold.
