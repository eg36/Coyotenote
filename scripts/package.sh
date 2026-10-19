#!/usr/bin/env bash
# Build the release archive: the app, stamped with VERSION, plus the docs.
# The Release workflow runs this for a tag; CI runs it as a dry run.
# Usage: scripts/package.sh VERSION  (writes dist/coyotenote_VERSION_linux_amd64.tar.gz)
set -euo pipefail
version=${1:?usage: scripts/package.sh VERSION}
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64
rm -rf package dist
mkdir -p package/docs dist
ldflags="-s -w -X github.com/eg36/coyotenote/internal/version.Version=$version"
go build -trimpath -ldflags "$ldflags" -o package/coyotenote ./cmd/coyotenote
test "$(package/coyotenote -version)" = "coyotenote $version"
cp README.md LICENSE THIRD_PARTY_NOTICES.md package/
cp -r docs/GUIDE.md docs/licenses package/docs/
tar -czf "dist/coyotenote_${version}_${GOOS}_${GOARCH}.tar.gz" -C package .
