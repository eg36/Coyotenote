#!/usr/bin/env bash
# Build the release archives: the app for each platform, stamped with
# VERSION, plus the docs. The Release workflow runs this for a tag; CI runs
# it as a dry run.
# Usage: scripts/package.sh VERSION
#   writes dist/coyotenote_VERSION_<os>_<arch>.tar.gz (.zip for Windows)
set -euo pipefail
version=${1:?usage: scripts/package.sh VERSION}
export CGO_ENABLED=0
rm -rf package dist
mkdir -p dist
ldflags="-s -w -X github.com/eg36/coyotenote/internal/version.Version=$version"
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64; do
  os=${target%/*} arch=${target#*/}
  name="coyotenote_${version}_${os}_${arch}"
  exe=coyotenote
  if [ "$os" = windows ]; then exe=coyotenote.exe; fi
  mkdir -p "package/$name/docs"
  GOOS=$os GOARCH=$arch go build -trimpath -ldflags "$ldflags" -o "package/$name/$exe" ./cmd/coyotenote
  cp README.md LICENSE THIRD_PARTY_NOTICES.md "package/$name/"
  cp -r docs/GUIDE.md docs/licenses "package/$name/docs/"
  if [ "$os" = windows ]; then
    (cd "package/$name" && zip -qr "../../dist/$name.zip" .)
  else
    tar -czf "dist/$name.tar.gz" -C "package/$name" .
  fi
done
# The build for this machine reports the version it was stamped with.
native="package/coyotenote_${version}_$(go env GOOS)_$(go env GOARCH)/coyotenote"
test "$("$native" -version)" = "coyotenote $version"
