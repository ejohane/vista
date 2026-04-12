#!/bin/bash
set -e

WORKTREE_PATH=$(pwd)
MAIN_WORKTREE=$(git worktree list | head -1 | awk '{print $1}')
STATE_DIR="apps/web/.wrangler/state"
SKIP_SEED_MARKER="$STATE_DIR/.skip-seed-from-main"

echo "[db:reset] Resetting local D1 database"

if [ -d "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
    echo "[db:reset] Removed local Wrangler state"
fi

bun run db:migrate:local

if [ "$WORKTREE_PATH" != "$MAIN_WORKTREE" ]; then
    mkdir -p "$STATE_DIR"
    echo "Fresh local database reset on $(date)" > "$SKIP_SEED_MARKER"
    echo "[db:reset] Marked worktree state to stay local"
fi

echo ""
echo "[db:reset] Local database reset complete"
echo "[db:reset] Run 'bun run db:seed:local' if you want demo data"
