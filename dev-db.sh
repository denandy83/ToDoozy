#!/bin/bash
# Dev DB Manager — Creates and manages rolling development database copies
# Usage:
#   ./dev-db.sh create <type>   — Copy production DB for development (type: feature|bugfix)
#   ./dev-db.sh path <type>     — Print the current dev DB path (type: feature|bugfix)
#   ./dev-db.sh cleanup <type>  — Remove old dev DBs beyond the rolling limit (type: feature|bugfix)
#   ./dev-db.sh list             — List all dev DBs

set -euo pipefail

PROD_DB="$HOME/Library/Application Support/todoozy/todoozy.db"
DEV_DB_DIR="$HOME/Library/Application Support/todoozy/dev-dbs"
MAX_COPIES=5

mkdir -p "$DEV_DB_DIR"

case "${1:-help}" in
  create)
    TYPE="${2:?Usage: dev-db.sh create <feature|bugfix>}"
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    DEV_DB="$DEV_DB_DIR/${TYPE}-${TIMESTAMP}.db"

    # Copy production DB (checkpoint WAL first for clean copy)
    sqlite3 "$PROD_DB" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
    cp "$PROD_DB" "$DEV_DB"

    # Clean up old copies beyond the rolling limit
    ls -1t "$DEV_DB_DIR"/${TYPE}-*.db 2>/dev/null | tail -n +$((MAX_COPIES + 1)) | while read -r old; do
      rm -f "$old" "${old}-shm" "${old}-wal"
      echo "Removed old dev DB: $(basename "$old")"
    done

    echo "$DEV_DB"
    ;;

  path)
    TYPE="${2:?Usage: dev-db.sh path <feature|bugfix>}"
    # Return the most recent dev DB of this type
    LATEST=$(ls -1t "$DEV_DB_DIR"/${TYPE}-*.db 2>/dev/null | head -1)
    if [ -z "$LATEST" ]; then
      echo "No dev DB found for type: $TYPE" >&2
      exit 1
    fi
    echo "$LATEST"
    ;;

  cleanup)
    TYPE="${2:?Usage: dev-db.sh cleanup <feature|bugfix>}"
    ls -1t "$DEV_DB_DIR"/${TYPE}-*.db 2>/dev/null | tail -n +$((MAX_COPIES + 1)) | while read -r old; do
      rm -f "$old" "${old}-shm" "${old}-wal"
      echo "Removed: $(basename "$old")"
    done
    echo "Cleanup complete. Kept latest $MAX_COPIES ${TYPE} DBs."
    ;;

  list)
    echo "Dev databases in $DEV_DB_DIR:"
    echo ""
    for type in feature bugfix; do
      COUNT=$(ls -1 "$DEV_DB_DIR"/${type}-*.db 2>/dev/null | wc -l | tr -d ' ' || echo "0")
      echo "  ${type}: ${COUNT} copies"
      ls -1t "$DEV_DB_DIR"/${type}-*.db 2>/dev/null | while read -r f; do
        SIZE=$(du -h "$f" | cut -f1)
        echo "    $(basename "$f")  ${SIZE}"
      done
    done
    ;;

  help|*)
    echo "Dev DB Manager — Rolling development database copies"
    echo ""
    echo "Usage:"
    echo "  ./dev-db.sh create <feature|bugfix>  — Create a new dev DB copy"
    echo "  ./dev-db.sh path <feature|bugfix>    — Get path to latest dev DB"
    echo "  ./dev-db.sh cleanup <feature|bugfix> — Remove old copies"
    echo "  ./dev-db.sh list                     — List all dev DBs"
    echo ""
    echo "Set TODOOZY_DEV_DB env var to use a dev DB:"
    echo "  export TODOOZY_DEV_DB=\$(./dev-db.sh create feature)"
    echo "  npm run dev"
    ;;
esac
