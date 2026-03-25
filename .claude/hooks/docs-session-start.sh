#!/bin/bash
# docs-session-start.sh — runs when a Claude session begins or resumes
# Writes a marker file if pending-changes.md has unprocessed content.
# Claude reads CLAUDE.md which instructs it to check this marker at session start.

REPO="/Users/andy.cassiers/Documents/Claude/todoozy"
PENDING="$REPO/pending-changes.md"
MARKER="$REPO/.docs-pending"

# Check if pending-changes.md has any entries below the header comment
if grep -q "^## " "$PENDING" 2>/dev/null; then
  # Write a marker file so Claude knows to process pending changes
  date +%Y-%m-%dT%H:%M:%S > "$MARKER"
fi

exit 0
