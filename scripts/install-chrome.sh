#!/usr/bin/env bash
# AI Dictionary — Chrome installer (non-tech, one command).
# Downloads the prebuilt extension from the latest GitHub Release, unzips it,
# and prints the manual chrome://extensions steps. Re-run any time to update.
#
# Overrides (mainly for testing):
#   AI_DICT_DIR      install location           (default: $HOME/.ai-dict)
#   AI_DICT_ZIP_URL  zip to download            (default: latest release asset)
set -euo pipefail

DIR="${AI_DICT_DIR:-$HOME/.ai-dict}"
URL="${AI_DICT_ZIP_URL:-https://github.com/hieplam/ai-dict/releases/latest/download/dist-chrome.zip}"
DEST="$DIR/dist"

for cmd in curl unzip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: '$cmd' is required but not installed." >&2
    exit 1
  fi
done

echo "Downloading AI Dictionary…"
tmp_zip="$(mktemp)"
trap 'rm -f "$tmp_zip"' EXIT
curl -fSL "$URL" -o "$tmp_zip"

# Clean any previous install so re-runs upgrade in place.
rm -rf "$DEST"
mkdir -p "$DEST"
unzip -q -o "$tmp_zip" -d "$DEST"

cat <<EOF

✅ AI Dictionary downloaded to:
   $DEST

Finish installing in Chrome (Chrome can't auto-install extensions):
  1. Open  chrome://extensions
  2. Turn on  Developer mode  (top-right)
  3. Click  Load unpacked  and select:
     $DEST
  4. Open the extension's Options page and paste your Gemini API key
  5. Select any word on a page to look it up

To update later, just run this installer again.
EOF
