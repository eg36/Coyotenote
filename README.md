<p align="center">
  <img src="logo.png" alt="Labradorite logo: a Labrador made of labradorite" width="240">
</p>

# Labradorite

A small, local-first Markdown notebook that runs in your browser. Your notes are
plain `.md` files in a folder you choose, and one binary serves the app to your
own computer only. No account, cloud service or network access.

> AI-assisted software. Keep backups of the notes that matter.

## Features

- Write visually or in Markdown, with preview and split view
- `[[Wiki links]]`, tags, pins, search across notes, and find and replace in a note
- For a computer used by one person: the app is closed to web pages, not to
  other accounts on the same machine
- Autosave that never overwrites outside changes, with draft recovery
- 14 themes, keyboard shortcuts and a phone-friendly layout

## Install

Download the Linux amd64 archive from
[Releases](https://github.com/eg36/Labradorite/releases) and check it against
`SHA256SUMS`, or build it with Go 1.26+:

```sh
git clone git@github.com:eg36/Labradorite.git
cd Labradorite
go build -o bin/labradorite ./cmd/labradorite
```

## Usage

```sh
labradorite              # the default notebook, at http://127.0.0.1:4280
labradorite ~/Notes      # any folder as a vault
```

The app opens in your browser (`-no-browser` only prints the address), and
Ctrl+C stops it. Chrome and Edge can install it as an app. The
[guide](docs/GUIDE.md) covers every feature, shortcut and safety rule.

## Your notes

- Notes stay plain Markdown, never converted. Hidden folders such as `.git` are
  ignored, so other tools can share the folder.
- Deleted notes go to `.trash/` in the vault until you empty it.
- Every 1.x release reads and writes vaults exactly as 1.0 does.

## Development

```sh
go vet ./... && go test -race ./...
npm ci && npm run typecheck && npm run build && npm test     # Node 24+
```

Linux amd64 is the only supported platform. See the
[guide](docs/GUIDE.md#development-and-ci) for the full checks.

## License

[MIT](LICENSE). Third-party licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
