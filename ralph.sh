#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [--tool amp|claude] [max_iterations]

set -e

# Parse arguments
TOOL="amp"  # Default to amp for backwards compatibility
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
      # Assume it's max_iterations if it's a number
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
      fi
      shift
      ;;
  esac
done

# Validate tool choice
if [[ "$TOOL" != "amp" && "$TOOL" != "claude" ]]; then
  echo "Error: Invalid tool '$TOOL'. Must be 'amp' or 'claude'."
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")
  
  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    # Archive the previous run
    DATE=$(date +%Y-%m-%d)
    # Strip "ralph/" prefix from branch name for folder
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    echo "   Archived to: $ARCHIVE_FOLDER"
    
    # Reset progress file for new run
    echo "# Ralph Progress Log" > "$PROGRESS_FILE"
    echo "Started: $(date)" >> "$PROGRESS_FILE"
    echo "---" >> "$PROGRESS_FILE"
  fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ -n "$CURRENT_BRANCH" ]; then
    echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
  fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
  echo "# Ralph Progress Log" > "$PROGRESS_FILE"
  echo "Started: $(date)" >> "$PROGRESS_FILE"
  echo "---" >> "$PROGRESS_FILE"
fi

LOG_FILE="$SCRIPT_DIR/ralph.log"
echo "Starting Ralph - Tool: $TOOL - Max iterations: $MAX_ITERATIONS"
echo "Log file: $LOG_FILE"
echo "Ralph started at $(date) - Tool: $TOOL - Max iterations: $MAX_ITERATIONS" > "$LOG_FILE"

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="
  echo "" >> "$LOG_FILE"
  echo "===============================================================" >> "$LOG_FILE"
  echo "  Iteration $i of $MAX_ITERATIONS ($TOOL) - $(date)" >> "$LOG_FILE"
  echo "===============================================================" >> "$LOG_FILE"

  # Run the selected tool with the ralph prompt
  # Use --output-format stream-json to get real-time streaming, tee to log file
  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cat "$SCRIPT_DIR/prompt.md" | amp --dangerously-allow-all 2>&1 | tee -a "$LOG_FILE" | tee /dev/stderr) || true
  else
    # Claude Code: use --verbose --output-format stream-json for real-time streaming to log
    ITER_LOG="$SCRIPT_DIR/.ralph-iter-$i.jsonl"
    claude --dangerously-skip-permissions --verbose --output-format stream-json < "$SCRIPT_DIR/CLAUDE.md" 2>>"$LOG_FILE" | tee "$ITER_LOG" | while IFS= read -r line; do
      # Extract assistant text messages for human-readable log
      type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
      if [[ "$type" == "assistant" ]]; then
        msg=$(echo "$line" | jq -r '.message // empty' 2>/dev/null)
        if [[ -n "$msg" ]]; then
          echo "$msg" >> "$LOG_FILE"
          echo "$msg" >&2
        fi
      elif [[ "$type" == "result" ]]; then
        msg=$(echo "$line" | jq -r '.result // empty' 2>/dev/null)
        if [[ -n "$msg" ]]; then
          echo "$msg" >> "$LOG_FILE"
          echo "$msg" >&2
        fi
      fi
    done || true
    # Extract the final result for completion check
    if [[ -f "$ITER_LOG" ]]; then
      OUTPUT=$(tail -1 "$ITER_LOG" | jq -r '.result // .message // empty' 2>/dev/null || echo "")
      # Also check all result lines for completion signal
      if grep -q "<promise>COMPLETE</promise>" "$ITER_LOG" 2>/dev/null; then
        OUTPUT="<promise>COMPLETE</promise>"
      fi
      rm -f "$ITER_LOG"
    else
      OUTPUT=""
    fi
  fi

  # Check for completion signal
  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed all tasks!"
    echo "Completed at iteration $i of $MAX_ITERATIONS"
    echo "Completed at iteration $i - $(date)" >> "$LOG_FILE"
    exit 0
  fi

  echo "Iteration $i complete. Continuing..."
  echo "Iteration $i complete - $(date)" >> "$LOG_FILE"
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
