#!/bin/bash
# docs-stop.sh — runs when Claude session stops
# Appends recent git commits to pending-changes.md for documentation processing next session

REPO="/Users/andy.cassiers/Documents/Claude/todoozy"
PENDING="$REPO/pending-changes.md"
MARKER="$REPO/.last-documented-commit"

cd "$REPO" || exit 0

# Get the last documented commit hash (if any)
LAST_COMMIT=""
if [ -f "$MARKER" ]; then
  LAST_COMMIT=$(cat "$MARKER")
fi

# Get commits since last documented commit, or last 10 if no marker
if [ -n "$LAST_COMMIT" ]; then
  COMMITS=$(git log --oneline "${LAST_COMMIT}..HEAD" --format="%h %s (%ad)" --date=short 2>/dev/null)
else
  COMMITS=$(git log --oneline -10 --format="%h %s (%ad)" --date=short 2>/dev/null)
fi

# Only write if there are new commits
if [ -n "$COMMITS" ]; then
  {
    echo ""
    echo "<!-- session-end: $(date +%Y-%m-%dT%H:%M:%S) -->"
    echo "## $(date +%Y-%m-%d) — Git commits (unprocessed)"
    echo "$COMMITS" | while IFS= read -r line; do
      echo "- $line"
    done
  } >> "$PENDING"
fi

# Update the marker to current HEAD
git rev-parse HEAD > "$MARKER" 2>/dev/null

exit 0
