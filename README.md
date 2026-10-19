<p align="center">
  <img src="logo.png" alt="coyotenote logo: a fox holding a note" width="280">
</p>

# coyotenote

> **AI-made software.** coyotenote was built with AI coding agents, Claude and
> Codex, as an experiment to test what modern agents can do. It is not intended
> to be used as a notepad for daily use; keep important notes in a tool built for
> that.

A small, local-first Markdown notebook that runs in your browser: folders of
plain `.md` files, a WYSIWYG editor and Markdown source, `[[wiki links]]`,
preview, autosave and 14 themes. One binary serves the app to your own computer
only. No account, cloud service or network access.

## Install

Download the Linux amd64 archive from
[Releases](https://github.com/eg36/Coyotenote/releases) and check it against
`SHA256SUMS`. Or build it with Go 1.26+:

```sh
git clone git@github.com:eg36/Coyotenote.git
cd Coyotenote
go build -o bin/coyotenote ./cmd/coyotenote
```

## Usage

```sh
coyotenote              # notes in ~/.local/share/coyotenote-web, at http://127.0.0.1:4280
coyotenote ~/Notes      # any folder as a vault
coyotenote -version
```

The app opens in your default browser (pass `-no-browser` to only print the
address). Keep the process running while you write; Ctrl+C stops it. Chrome
and Edge can install it as an app with its own window. See
[docs/GUIDE.md](docs/GUIDE.md) for everything the app does, its shortcuts and
its safety rules.

## Notes and links

- A vault is a folder of `.md` files; the file name is the note's title.
  Subfolders group notes, and hidden folders (`.git`, `.obsidian`, `.trash`) are
  ignored, so the same folder opens in Obsidian.
- Links use Obsidian syntax: `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading]]`,
  `[[Note|text]]`. Typing `[[` suggests notes.
- Deleted notes go to `.trash/` in the vault and are never emptied automatically.

## Safety

- Autosave runs 400 ms after you stop typing, with atomic writes.
- Notes changed by another program are never overwritten; you compare and choose.
- Unsaved edits are kept as browser drafts until they reach the file.
- Files coyotenote can't edit safely (over 10,000 lines or 4 MiB, not UTF-8,
  symlinks, control characters) are skipped with a warning and left untouched.
- Line endings (LF or CRLF) and tabs are preserved.

## Development

```sh
go vet ./... && go test -race ./...
go build -o bin/coyotenote ./cmd/coyotenote && python3 scripts/smoke_web.py
npm ci && npm run build && npm test     # browser tests, Node 24+
```

Linux amd64 is the only supported platform.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
