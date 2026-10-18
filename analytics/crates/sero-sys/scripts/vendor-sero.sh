#!/usr/bin/env bash
# Replaces vendor/sero with the headers and license of a sero release tag.
#   crates/sero-sys/scripts/vendor-sero.sh v0.2.4
set -euo pipefail

tag="${1:?usage: vendor-sero.sh <tag>}"
repo="${SERO_REPO:-https://github.com/mad201802/sero.git}"
dest="$(cd "$(dirname "$0")/.." && pwd)/vendor/sero"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

git clone --quiet --depth 1 --branch "$tag" "$repo" "$tmp/sero"
commit="$(git -C "$tmp/sero" rev-parse HEAD)"

rm -rf "$dest"
mkdir -p "$dest"
cp -R "$tmp/sero/include" "$tmp/sero/LICENSE" "$dest/"
echo "$tag $commit ${repo%.git}" > "$dest/VERSION"
echo "vendored sero $tag ($commit); check shim/sero_shim.cpp still compiles and run cargo test -p sero-sys"
