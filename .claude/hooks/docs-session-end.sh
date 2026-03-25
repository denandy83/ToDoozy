#!/bin/bash
# docs-session-end.sh — runs on SessionEnd
# Appends new git commits with file-change context to pending-changes.md.
# The /fix and /feature skills write rich entries during the session.
# This hook is a fallback that captures anything not explicitly logged.

REPO="/Users/andy.cassiers/Documents/Claude/todoozy"
PENDING="$REPO/pending-changes.md"
MARKER="$REPO/.last-documented-commit"
PENDING_FLAG="$REPO/.docs-pending"

cd "$REPO" || exit 0

# Get the last documented commit hash
LAST_COMMIT=""
if [ -f "$MARKER" ]; then
  LAST_COMMIT=$(cat "$MARKER")
fi

# Get commits since last documented, or last 10 if no marker
if [ -n "$LAST_COMMIT" ] && git cat-file -e "${LAST_COMMIT}^{commit}" 2>/dev/null; then
  COMMITS=$(git log "${LAST_COMMIT}..HEAD" --format="%H %h %s (%ad)" --date=short 2>/dev/null)
else
  COMMITS=$(git log -10 --format="%H %h %s (%ad)" --date=short 2>/dev/null)
fi

if [ -n "$COMMITS" ]; then
  {
    echo ""
    echo "## $(date +%Y-%m-%d) — Session end (git fallback)"
    echo "<!-- Low-context entries. Use commit messages + file changes to infer docs updates. -->"
    while IFS= read -r line; do
      FULL_HASH=$(echo "$line" | awk '{print $1}')
      REST=$(echo "$line" | cut -d' ' -f2-)
      FILE_COUNT=$(git diff-tree --no-commit-id -r --name-only "$FULL_HASH" 2>/dev/null | wc -l | tr -d ' ')
      echo "- $REST — files: $FILE_COUNT"
    done <<< "$COMMITS"
  } >> "$PENDING"

  # Signal that there are pending changes to process at next session start
  date +%Y-%m-%dT%H:%M:%S > "$PENDING_FLAG"
fi

# Update the marker to current HEAD
git rev-parse HEAD > "$MARKER" 2>/dev/null

exit 0
