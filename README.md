<p align="center">
  <img src="logo.png" alt="Labradorite logo: a Labrador made of labradorite" width="240">
</p>

# Labradorite

A local workspace in your browser, with an optional Notes plugin.
Notes stay plain Markdown in a folder you choose, served by one
binary on your own computer. No account or cloud service. Works offline;
web embeds contact external services only after being enabled and loaded.

This checkout is developing **Labradorite Space 2026.1.0**. The published
stable **v1.5.0** is the earlier notebook; the Space features below are in
source and development builds. See the [roadmap](docs/ROADMAP.md).

> AI-assisted software. Keep backups of the notes that matter.

## Features

- Optional Notes, a keyboard plugin switcher, and a Library of vault files
- Visual Markdown editing, Preview/Split views, wiki links, tags, pins and search
- Note, image, PDF, audio and video embeds in Write and Preview; opt-in web embeds
- Autosave, revision conflict checks, recoverable browser drafts, history and trash
- Light, Dark and System appearance; keyboard controls and phone workflows for Notes
- For a computer used by one person: the app is closed to unrelated web pages,
  but local accounts and programs can access its loopback API

## Install

Download the Linux amd64 archive from
[Releases](https://github.com/eg36/Labradorite/releases) and check it against
`SHA256SUMS`. Internal Linux and Windows test packages for amd64 and arm64
are available from [Test builds](https://github.com/eg36/Labradorite/actions/workflows/test-build.yml),
without appearing in Releases. See the [download guide](docs/GUIDE.md#test-build-downloads-and-windows).
Or build it with Go 1.26+:

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
- Existing Markdown notes open without conversion, including files in an
  `issues/` folder from earlier development builds. Disabling Notes keeps its files.

## Development

```sh
go vet ./... && go test -race ./...
npm ci && npm run typecheck && npm run build                # Node 24+
go build -o bin/labradorite ./cmd/labradorite
npm test
```

The stable v1.5.0 package supports Linux amd64. Four-target Actions packages
are test builds; each download records native checks and remaining manual checks. See the
[guide](docs/GUIDE.md#development-and-ci) for the full checks.

## License

[MIT](LICENSE). Third-party licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
