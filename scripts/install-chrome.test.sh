#!/usr/bin/env bash
# Offline test for install-chrome.sh: build a fixture zip, serve it via file://,
# run the installer against a temp dir, assert the extension extracted.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/install-chrome.sh"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Build a fixture that mirrors the real release zip: manifest.json at top level.
fixture_src="$work/dist-src"
mkdir -p "$fixture_src"
printf '%s\n' '{"manifest_version":3,"name":"AI Dictionary","version":"0.0.0"}' \
  > "$fixture_src/manifest.json"
fixture_zip="$work/dist-chrome.zip"
( cd "$fixture_src" && zip -qr "$fixture_zip" . )

install_dir="$work/install"
AI_DICT_DIR="$install_dir" AI_DICT_ZIP_URL="file://$fixture_zip" bash "$script"

if [ ! -f "$install_dir/dist/manifest.json" ]; then
  echo "FAIL: expected $install_dir/dist/manifest.json to exist" >&2
  exit 1
fi
echo "PASS: install-chrome.sh extracted the extension to $install_dir/dist"
