# Web alpha implementation notes

Reference: terminal `main` at dcb6a51c5dbf79efd6859cb506dd736bdc061996.
All implementation changes are on `web_alpha`, descended from its empty initial
commit; no merge or source change was made on `main`.

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
source formatting after actual rich edits. Unsupported front matter, footnotes,
raw HTML and image references keep a note in source mode. Simply opening a note
or switching modes never normalizes its file.

The app does not add hosted access, authentication, sync, attachments, tags,
collaboration, PDF export, a background daemon or an application release. It does
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
external fonts or telemetry are used.

Each browser tab has its own draft key under a vault-specific prefix. A pending
draft blocks editing until restored/discarded and survives additional reloads.
Restoring a draft keeps its original base revision: an old draft cannot overwrite
newer disk content. A server restart changes the request token; Retry save refreshes
the local token before retrying.

The original Linux CI settings are retained, with a web_alpha push trigger and
an added Chromium job. No release workflow is present. The Go/API checks and a
standard-library Python smoke test run without npm; frontend CI rebuilds assets
and verifies the committed output before browser tests.

## Morning test checklist

1. Check out web_alpha, build `bin/coyotenote`, run it with a temporary vault.
2. Open the printed localhost URL and create a note in Write mode.
3. Use headings, bold, a checklist and a table. Switch to Markdown, Preview and Split.
4. Reload and confirm saved content; try changing the theme and reload again.
5. Create a second note, insert a wiki link, follow it, inspect backlinks and go back.
6. Search note contents, rename/move a note, trash it and use Undo.
7. Open the same note in two tabs. Edit one, then the other; the second must report
   a conflict while keeping the first version on disk.
8. Stop the server, type a draft, restart the server, and reload. Restore the draft,
   then save; no draft should silently replace a newer disk revision.
9. Narrow the browser: notes become a drawer and Split stacks vertically.
10. Only after these alpha checks should monorepo/release work be considered.
