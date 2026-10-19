# Coyotenote web alpha

- Work on `web_alpha`. `main` is the separate terminal application; don't modify it
  as part of web alpha work.
- This is an unreleased alpha. Do not create tags, releases or deployments during
  alpha development. The monorepo and combined releases are planned separately.
- The `web` package embeds `web/index.html`, `web/logo.png` and the committed `web/assets/` bundle. Frontend edits
  require `npm run build`, followed by a Go rebuild.
- Preserve plain Markdown vaults, the original theme IDs and named upstream palettes, atomic writes,
  revision conflict checks and recoverable browser drafts.
- Give each feature, fix or independent change its own focused commit. Include
  its relevant tests and generated bundle changes; do not bundle unrelated work.
- Validate relevant changes with `go vet ./...`, `go test -race ./...`,
  `go build -o bin/coyotenote-web ./cmd/coyotenote-web`, `python3 scripts/smoke_web.py`, and browser tests
  (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test` when using an installed
  Chromium). Keep the committed bundle current.
- Preserve the human author/committer identity. Every commit made or amended by
  Codex must end with exactly one trailer:

  Co-authored-by: codex <codex@openai.com>
