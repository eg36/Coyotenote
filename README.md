<p align="center">
  <img src="logo.png" alt="Labradorite logo: a Labrador made of labradorite" width="240">
</p>

# Labradorite

> **AI-made software.** Labradorite was built by AI coding agents, Claude and
> Codex, to see how far modern agents can take a real app. Your notes stay plain
> Markdown files that any editor can open; as with any notes app, keep backups
> of the ones that matter.

A small, local-first Markdown notebook that runs in your browser: folders of
plain `.md` files, a WYSIWYG editor and Markdown source, `[[wiki links]]`,
preview, autosave and 14 themes. One binary serves the app to your own computer
only. No account, cloud service or network access.

## Install

Download the Linux amd64 archive from
[Releases](https://github.com/eg36/Labradorite/releases) and check it against
`SHA256SUMS`. Or build it with Go 1.26+:

```sh
git clone git@github.com:eg36/Labradorite.git
cd Labradorite
go build -o bin/labradorite ./cmd/labradorite
```

## Usage

```sh
labradorite              # notes in ~/.local/share/labradorite, at http://127.0.0.1:4280
labradorite ~/Notes      # any folder as a vault
labradorite -version
```

The app opens in your default browser (pass `-no-browser` to only print the
address). A new default notebook starts with a short welcome note. Keep the
process running while you write; Ctrl+C stops it. Chrome
and Edge can install it as an app with its own window. See
[docs/GUIDE.md](docs/GUIDE.md) for everything the app does, its shortcuts and
its safety rules.

Labradorite was called **coyotenote** until v0.6.1. On its first start it
moves the old default folder, `~/.local/share/coyotenote-web`, to
`~/.local/share/labradorite`, and browser drafts carry over.

## Notes and links

- A vault is a folder of `.md` files; the file name is the note's title.
  Subfolders group notes, and hidden folders (`.git`, `.obsidian`, `.trash`) are
  ignored, so the same folder opens in Obsidian.
- Links use Obsidian syntax: `[[Note]]`, `[[Folder/Note]]`, `[[Note#Heading]]`,
  `[[Note|text]]`. Typing `[[` suggests notes.
- Deleted notes go to `.trash/` in the vault and are never emptied automatically;
  the Trash dialog can delete them for good.

## Safety

- Autosave runs 400 ms after you stop typing, with atomic writes.
- Notes changed by another program are never overwritten; you compare and choose.
- Unsaved edits are kept as browser drafts until they reach the file.
- Files Labradorite can't edit safely (over 10,000 lines or 4 MiB, not UTF-8,
  symlinks, control characters) are skipped with a warning and left untouched.
- Line endings (LF or CRLF) and tabs are preserved.

## Your notes across versions

From 1.0, every 1.x release reads and writes vaults exactly as 1.0 does:
plain `.md` files, never converted or given extra headers, with the trash,
history and attachments in the same folders. Settings and browser drafts carry
over. Upgrading means replacing the binary. See
[the guide](docs/GUIDE.md#your-notes-across-versions) for what Labradorite
stores and where.

## Development

```sh
go vet ./... && go test -race ./...
go build -o bin/labradorite ./cmd/labradorite && python3 scripts/smoke_web.py
npm ci && npm run typecheck && npm run build && npm test     # browser tests, Node 24+
```

Linux amd64 is the only supported platform.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
