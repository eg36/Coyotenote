# Coyotenote

- One Go module holds two apps: the terminal app in `cmd/coyotenote` and the web
  app in `cmd/coyotenote-web`. Both read and write vaults through
  `internal/vault`; change vault behavior there, for both apps at once.
- Releases ship both apps in one archive, built by the release workflow from a
  `v*` tag with notes in `.github/release-notes/<tag>.md`; a release is titled
  with the bare tag, such as `v0.4.0`. Create tags or releases only when asked.
- The `web` package embeds `web/index.html`, `web/logo.png` and the committed `web/assets/` bundle. Frontend edits
  require `npm run build`, followed by a Go rebuild.
- Preserve plain Markdown vaults, the original theme IDs and named upstream palettes, atomic writes,
  revision conflict checks and recoverable browser drafts.
- Give each feature, fix or independent change its own focused commit. Include
  its relevant tests and generated bundle changes; do not bundle unrelated work.
- Validate relevant changes with `go vet ./...`, `go test -race ./...`,
  `go build -o bin/coyotenote ./cmd/coyotenote`, `python3 scripts/smoke_terminal.py`,
  `go build -o bin/coyotenote-web ./cmd/coyotenote-web`, `python3 scripts/smoke_web.py`, and browser tests
  (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test` when using an installed
  Chromium). Keep the committed bundle current.
- Preserve the human author/committer identity. Every commit made or amended by
  Codex must end with exactly one trailer:

  Co-authored-by: codex <codex@openai.com>
