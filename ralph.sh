#!/bin/bash
# Ralph — long-running AI implementation loop.
# Reads prd.json, picks next story with passes:false, implements, marks passes:true, repeats.
# Generated from ~/.claude/templates/ralph.sh.tmpl by /feature-init.
#
# Usage: ./ralph.sh [--tool amp|claude] [max_iterations]
# Project knobs are set near the top of this file.

set -e

# ============================================================
# PROJECT KNOBS — edit these per project
# ============================================================
PROJECT_NAME="ToDoozy"
TEST_COMMAND="npm run test"
TYPECHECK_COMMAND="npm run typecheck"
PRE_RUN_HOOK="DEV_DB=$("$SCRIPT_DIR/dev-db.sh" create feature)
export TODOOZY_DEV_DB="$DEV_DB""   # optional script path or empty
POST_RUN_HOOK="" # optional script path or empty

# ============================================================
# ARG PARSING
# ============================================================
TOOL="claude"
MAX_ITERATIONS=10

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool) TOOL="$2"; shift 2 ;;
    --tool=*) TOOL="${1#*=}"; shift ;;
    *) [[ "$1" =~ ^[0-9]+$ ]] && MAX_ITERATIONS="$1"; shift ;;
  esac
done

if [[ "$TOOL" != "amp" && "$TOOL" != "claude" && "$TOOL" != "codex" ]]; then
  echo "Error: --tool must be amp, claude, or codex"; exit 1
fi

# ============================================================
# PATHS
# ============================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRD_FILE="$SCRIPT_DIR/prd.json"
PROMPT_FILE="$SCRIPT_DIR/prompt.md"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"
LOG_FILE="$SCRIPT_DIR/ralph.log"

# ============================================================
# PRD IDENTITY GUARD — refuse to run on another project's backlog
# (2026-07-11: a wrong-CWD run once clobbered Eitjebreken's prd.json
# with salesforce data; this check makes that impossible.)
# ============================================================
if [ -f "$PRD_FILE" ]; then
  PRD_PROJECT=$(jq -r '.project // empty' "$PRD_FILE" 2>/dev/null || echo "")
  if [ "$PRD_PROJECT" != "$PROJECT_NAME" ]; then
    echo "ERROR: prd.json identity check failed (found project='$PRD_PROJECT', expected '$PROJECT_NAME')."
    echo "Refusing to run. Restore or fix prd.json first."
    exit 4
  fi
fi

# ============================================================
# ARCHIVE PREVIOUS RUN IF BRANCH CHANGED
# ============================================================
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

  if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
    DATE=$(date +%Y-%m-%d)
    FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
    ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"
    echo "Archiving previous run: $LAST_BRANCH"
    mkdir -p "$ARCHIVE_FOLDER"
    [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
    [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
    : > "$PROGRESS_FILE"
    {
      echo "# Ralph Progress Log — $PROJECT_NAME"
      echo "Started: $(date)"
      echo "---"
    } >> "$PROGRESS_FILE"
  fi
fi

if [ -f "$PRD_FILE" ]; then
  CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
  [ -n "$CURRENT_BRANCH" ] && echo "$CURRENT_BRANCH" > "$LAST_BRANCH_FILE"
fi

if [ ! -f "$PROGRESS_FILE" ]; then
  {
    echo "# Ralph Progress Log — $PROJECT_NAME"
    echo "Started: $(date)"
    echo "---"
  } > "$PROGRESS_FILE"
fi

# ============================================================
# PRE-RUN HOOK
# ============================================================
if [ -n "$PRE_RUN_HOOK" ] && [ -x "$SCRIPT_DIR/$PRE_RUN_HOOK" ]; then
  echo "Running pre-run hook: $PRE_RUN_HOOK"
  "$SCRIPT_DIR/$PRE_RUN_HOOK" || echo "Warning: pre-run hook exited non-zero"
fi

# ============================================================
# ITERATION LOOP
# ============================================================
echo "Ralph starting — Tool: $TOOL — Max iterations: $MAX_ITERATIONS"
echo "Project: $PROJECT_NAME"
echo "Log file: $LOG_FILE"
echo "Ralph started at $(date) — Tool: $TOOL — Max iterations: $MAX_ITERATIONS — Project: $PROJECT_NAME" > "$LOG_FILE"

# Ensure prompt.md exists
if [ ! -f "$PROMPT_FILE" ]; then
  echo "Error: $PROMPT_FILE not found. Run /feature-init to bootstrap."
  exit 2
fi

for i in $(seq 1 $MAX_ITERATIONS); do
  echo ""
  echo "==============================================================="
  echo "  Ralph Iteration $i of $MAX_ITERATIONS ($TOOL)"
  echo "==============================================================="
  {
    echo ""
    echo "==============================================================="
    echo "  Iteration $i of $MAX_ITERATIONS ($TOOL) — $(date)"
    echo "==============================================================="
  } >> "$LOG_FILE"

  if [[ "$TOOL" == "amp" ]]; then
    OUTPUT=$(cat "$PROMPT_FILE" | amp --dangerously-allow-all 2>&1 | tee -a "$LOG_FILE" | tee /dev/stderr) || true
  elif [[ "$TOOL" == "codex" ]]; then
    # Harness-abstracted spawn: final message on stdout, transcript in the log.
    # Model/effort via RALPH_MODEL/RALPH_EFFORT (passed through verbatim to codex).
    OUTPUT=$(~/.claude/scripts/agent-run.sh --harness codex \
      ${RALPH_MODEL:+--model "$RALPH_MODEL"} ${RALPH_EFFORT:+--effort "$RALPH_EFFORT"} \
      --prompt-file "$PROMPT_FILE" --log "$LOG_FILE") || true
    echo "$OUTPUT" >&2
    # Cap detection (codex message shape is provider-side; keep the net wide) → exit 3 for supervisors.
    if tail -n 50 "$LOG_FILE" | grep -iqE 'rate.?limit|usage limit|quota (reached|exceeded)|too many requests|\b429\b'; then
      echo "CAP-BLOCK (codex) at iteration $i — $(date)" >> "$LOG_FILE"
      [ -n "$POST_RUN_HOOK" ] && [ -x "$SCRIPT_DIR/$POST_RUN_HOOK" ] && "$SCRIPT_DIR/$POST_RUN_HOOK"
      exit 3
    fi
  else
    ITER_LOG="$SCRIPT_DIR/.ralph-iter-$i.jsonl"
    # Model pinned 2026-06-10: Opus 4.8 — best long-horizon agentic coding; pin protects
    # against managed-settings/default changes. Runs under the GATED auto permission mode
    # (--permission-mode auto), NOT --dangerously-skip-permissions: tool calls are classifier-
    # approved rather than blanket-bypassed. Per-run overrides:
    #   RALPH_EFFORT=max ./ralph.sh --tool claude 3              # deeper reasoning (slower, more tokens)
    #   RALPH_MODEL=claude-fable-5 ./ralph.sh --tool claude 3
    #   RALPH_PERM=bypassPermissions ./ralph.sh --tool claude 3  # escape hatch if a project truly needs full bypass
    claude -p --model "${RALPH_MODEL:-claude-opus-4-8}" --effort "${RALPH_EFFORT:-xhigh}" --permission-mode "${RALPH_PERM:-auto}" --verbose --output-format stream-json < "$PROMPT_FILE" 2>>"$LOG_FILE" | tee "$ITER_LOG" | while IFS= read -r line; do
      type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
      if [[ "$type" == "assistant" || "$type" == "result" ]]; then
        msg=$(echo "$line" | jq -r '.message // .result // empty' 2>/dev/null)
        [[ -n "$msg" ]] && { echo "$msg" >> "$LOG_FILE"; echo "$msg" >&2; }
      fi
    done || true
    if [[ -f "$ITER_LOG" ]]; then
      # Cap-block detection (2026-07-11): a session-limit refusal arrives as a synthetic
      # assistant message ("model": "<synthetic>", "You've hit your session limit · resets …").
      # Burning the remaining iterations on it is pure waste — exit 3 so a supervisor
      # (overnight.sh / orchestrate ticks) can wait for the reset and retry.
      if grep -qE '"model"[[:space:]]*:[[:space:]]*"<synthetic>"|hit your session limit|Claude usage limit reached' "$ITER_LOG" 2>/dev/null; then
        echo ""
        echo "Usage/session limit detected at iteration $i — exiting with code 3 for supervisor retry."
        echo "CAP-BLOCK at iteration $i — $(date)" >> "$LOG_FILE"
        rm -f "$ITER_LOG"
        [ -n "$POST_RUN_HOOK" ] && [ -x "$SCRIPT_DIR/$POST_RUN_HOOK" ] && "$SCRIPT_DIR/$POST_RUN_HOOK"
        exit 3
      fi
      OUTPUT=$(tail -1 "$ITER_LOG" | jq -rR 'fromjson? | .result // .message // empty' 2>/dev/null || echo "")
      # Only scan the agent's final result text — the raw stream echoes the
      # prompt, which contains the literal promise tag and would match every iteration.
      # -R + fromjson? skips non-JSON lines (e.g. a SessionStart hook banner printed
      # before the JSON stream) so completion detection doesn't silently fail.
      if jq -rR 'fromjson? | select(.type == "result") | .result // empty' "$ITER_LOG" 2>/dev/null | grep -q "<promise>COMPLETE</promise>"; then
        OUTPUT="<promise>COMPLETE</promise>"
      fi
      rm -f "$ITER_LOG"
    else
      OUTPUT=""
    fi
  fi

  if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
    echo ""
    echo "Ralph completed all tasks at iteration $i."
    echo "Completed at iteration $i — $(date)" >> "$LOG_FILE"
    [ -n "$POST_RUN_HOOK" ] && [ -x "$SCRIPT_DIR/$POST_RUN_HOOK" ] && "$SCRIPT_DIR/$POST_RUN_HOOK"
    exit 0
  fi

  echo "Iteration $i complete. Continuing..."
  echo "Iteration $i complete — $(date)" >> "$LOG_FILE"
  sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE and $LOG_FILE for status."
[ -n "$POST_RUN_HOOK" ] && [ -x "$SCRIPT_DIR/$POST_RUN_HOOK" ] && "$SCRIPT_DIR/$POST_RUN_HOOK"
exit 1
