<p align="center">
  <img src="logo.png" alt="coyotenote logo: a fox holding a note" width="280">
</p>

# coyotenote

> **AI-made software.** coyotenote was built with AI coding agents, Claude and
> Codex, as an experiment to test what modern agents can do. It is not intended
> to be used as a notepad for daily use; keep important notes in a tool built for
> that.

A small, local-first Markdown notebook for the terminal, with an experimental
browser version: folders of plain `.md` files, `[[wiki links]]`, live preview,
autosave and 14 themes. No account, cloud service or network access.

## Install

Download the Linux amd64 archive from
[Releases](https://github.com/eg36/Coyotenote/releases) and check it against
`SHA256SUMS`. It holds both apps: `coyotenote` for the terminal and
`coyotenote-web` for the browser. Or build them with Go 1.26+:

```sh
go build -o bin/coyotenote ./cmd/coyotenote
go build -o bin/coyotenote-web ./cmd/coyotenote-web
```

## Usage

```sh
coyotenote              # notes in ~/.local/share/coyotenote
coyotenote ~/Notes      # any folder as a vault
coyotenote -version
```

For Ctrl+C/X/V, install `wl-clipboard` (Wayland) or `xclip`/`xsel` (X11). Your
terminal's own paste always works, including over SSH.

## Keys

| Key | Action |
| --- | --- |
| Ctrl+N | New note (`Name` or `Folder/Name`) |
| Ctrl+O | Find or browse notes |
| Ctrl+R | Rename or move; links to the note are updated |
| Ctrl+G / Ctrl+Y | Follow the `[[link]]` under the cursor / go back |
| Ctrl+L | Notes linking here |
| Ctrl+D / Ctrl+Z | Move to trash / undo it |
| Alt+↑ / Alt+↓ | Previous / next note |
| Ctrl+P | Editor → preview → split view |
| Ctrl+T | Choose a theme |
| Shift+arrows | Select text |
| Ctrl+C / X / V | Copy / cut / paste |
| Tab / Shift+Tab | Indent / outdent |
| Ctrl+S / Ctrl+Q | Save / save and quit |
| F1 | All keys |

## Notes and links

- A vault is a folder of `.md` files; the file name is the note's title.
  Subfolders group notes, and hidden folders (`.git`, `.obsidian`, `.trash`) are
  ignored, so the same folder opens in Obsidian.
- Links use Obsidian syntax: `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading]]`,
  `[[Note|text]]`. Typing `[[` suggests notes.
- Deleted notes go to `.trash/` in the vault and are never emptied automatically.

## Safety

- Autosave runs 400 ms after you stop typing, with atomic writes.
- If a save fails, quitting writes a recovery copy and shows its path.
- Notes changed by another program are never overwritten.
- Files coyotenote can't edit safely (over 10,000 lines, not UTF-8, symlinks,
  control characters) are skipped with a warning and left untouched.
- Line endings (LF or CRLF) and tabs are preserved.

## Web app

`coyotenote-web` is an experimental browser version that runs a local server and
uses the same vault format, links, trash and themes. It is experimental; its
default vault (`~/.local/share/coyotenote-web`) is separate from the terminal
app's.

```sh
coyotenote-web                  # then open http://127.0.0.1:4280
coyotenote-web ~/Notes          # any folder as a vault
```

See [docs/WEB.md](docs/WEB.md) for features, safety and development.

## Development

```sh
go vet ./... && go test -race ./...
go build -o bin/coyotenote ./cmd/coyotenote && python3 scripts/smoke_terminal.py
go build -o bin/coyotenote-web ./cmd/coyotenote-web && python3 scripts/smoke_web.py
```

Browser tests for the web app need Node 24+: `npm ci && npm run build && npm test`.

Linux amd64 is the only supported platform.

## License

[MIT](LICENSE). The editor is adapted from
[Bubbles](https://github.com/charmbracelet/bubbles) textarea (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
