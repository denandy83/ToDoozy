#!/usr/bin/env bash
# Fetches release notes from GitHub and bundles them into resources/release-notes.md
# Uses `gh` CLI for authenticated requests (avoids rate limits).
# Called before `electron-builder` during `npm run dist:mac`.

set -euo pipefail

REPO="denandy83/ToDoozy"
OUTPUT="resources/release-notes.md"

if ! command -v gh &> /dev/null; then
  echo "[bundle-release-notes] gh CLI not found, skipping"
  exit 0
fi

echo "[bundle-release-notes] Fetching releases from $REPO..."

gh api "repos/$REPO/releases" --jq '
  .[] | select(.draft == false and .prerelease == false) |
  "## \(.tag_name)\n\(.body // "No release notes.")\n"
' 2>/dev/null | sed '/^## /!{ /^## /!s/^## .*//; }' > "$OUTPUT.tmp"

# Strip any ## headers from inside release bodies (keep only the top-level ## tag headers)
awk '
  /^## v/ { print; next }
  /^## /  { next }
  { print }
' "$OUTPUT.tmp" > "$OUTPUT"

rm -f "$OUTPUT.tmp"

LINES=$(wc -l < "$OUTPUT" | tr -d ' ')
echo "[bundle-release-notes] Wrote $LINES lines to $OUTPUT"
