#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop (modified for file access)
# Usage: ./ralph.sh [--tool amp|claude] [max_iterations]

set -e

TOOL="claude"
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool)
      TOOL="$2"
      shift 2
      ;;
    --tool=*)
      TOOL="${1#*=}"
      shift
      ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi

# Find project root (where prd.json lives)
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$PROJECT_ROOT/prd.json"
PROGRESS_FILE="$PROJECT_ROOT/progress.txt"
CLAUDE_MD="$PROJECT_ROOT/CLAUDE.md"

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

echo "Starting Ralph - Tool: $TOOL - Max iterations: $MAX_ITERATIONS"
echo "Project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="

  # Check if all stories are complete before starting
  REMAINING=$(jq '[.stories[] | select(.passes == false)] | length' "$PRD_FILE" 2>/dev/null || echo "0")
  if [ "$REMAINING" -eq 0 ]; then
    echo ""
    echo "All stories complete!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  NEXT_STORY=$(jq -r '[.stories[] | select(.passes == false)][0].title' "$PRD_FILE" 2>/dev/null || echo "unknown")
  echo "Next story: $NEXT_STORY ($REMAINING remaining)"

  # Read CLAUDE.md content as the prompt
  PROMPT=$(cat "$CLAUDE_MD")

  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(echo "$PROMPT" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
  else
    # Run Claude in the project directory with full file access
    # -p flag sends a prompt, --dangerously-skip-permissions for autonomous operation
    OUTPUT=$(claude -p "$PROMPT" --dangerously-skip-permissions 2>&1 | tee /dev/stderr) || true
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    exit 0
  fi

  echo "Iteration $i complete. Continuing..."
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
