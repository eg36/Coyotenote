# Labradorite

- One Go module holds the app: a local web server in `cmd/labradorite` with its
  browser frontend in `web/`. It reads and writes vaults through
  `internal/vault`; keep vault rules (paths, locking, writes, trash, links) there.
- Releases ship the app in one archive, built by the release workflow from a
  stable `vMAJOR.MINOR.PATCH` tag with notes in `.github/release-notes/<tag>.md`;
  a release is titled with the bare tag, such as `v1.5.0`. Prerelease tags never
  publish a Release. Test downloads belong in Actions artifacts; a test version
  can be stamped without a Git tag. Create tags or releases only when asked.
- The `web` package embeds `web/index.html`, `web/logo.png` and the committed `web/assets/` bundle. Frontend edits
  require `npm run build`, followed by a Go rebuild.
- Preserve plain Markdown vaults, the original theme IDs and named upstream palettes, atomic writes,
  revision conflict checks and recoverable browser drafts.
- Work is tracked as GitHub issues in eg36/Labradorite. Before starting a
  feature or fix, find its issue or create one with `gh issue create`: a
  plain title, what and why, and how to tell it is done. A bug found along the
  way gets its own issue before it is fixed. Commits reference their issue,
  and the commit that completes it says `Fixes #N` in its message. When it is
  done, tick its `Done when:` checkboxes and comment on the issue with what
  changed and how it was verified. Keep committing to main until the user
  switches to branches and pull requests.
- Issues are written impersonally (what happens now, what to build, then
  `Done when:` as `- [ ]` checkboxes). Linear (team Labradorite, LBT) mirrors
  them: assign each issue to the user, put it in the matching project
  (Labradorite 1.5 or Labradorite 2.0), and label it with one Type (Feature,
  Improvement, Bug, Docs, Maintenance, Tech debt, Research), its areas
  (Frontend, Backend, Web, UX, API, Infra…) and, when relevant, an Impact
  (Reliability, Security, Performance, Accessibility). Labels sync both ways.
- Give each feature, fix or independent change its own focused commit. Include
  its relevant tests and generated bundle changes; do not bundle unrelated work.
- Validate relevant changes with `go vet ./...`, `go test -race ./...`,
  `go build -o bin/labradorite ./cmd/labradorite`, `python3 scripts/smoke_web.py`, and browser tests
  (`PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test` when using an installed
  Chromium). Keep the committed bundle current.
- Preserve the human author/committer identity. Every commit made or amended by
  Codex must end with exactly one trailer:

  Co-authored-by: codex <codex@openai.com>
