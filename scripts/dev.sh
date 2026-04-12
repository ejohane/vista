#!/bin/bash
set -e

WORKTREE_PATH=$(pwd)
MAIN_WORKTREE=$(git worktree list | head -1 | awk '{print $1}')
STATE_DIR="apps/web/.wrangler/state"
SEEDED_MARKER="$STATE_DIR/.seeded-from-main"
SKIP_SEED_MARKER="$STATE_DIR/.skip-seed-from-main"

port_in_use() {
    command -v lsof >/dev/null 2>&1 && lsof -i :$1 >/dev/null 2>&1
}

find_available_port() {
    local base=$1
    local min=$2
    local max=$3
    local port=$base
    local attempts=$((max - min + 1))

    for ((i=0; i<attempts; i++)); do
        if ! port_in_use $port; then
            echo $port
            return 0
        fi

        port=$((port + 1))
        if [ $port -gt $max ]; then
            port=$min
        fi
    done

    echo $base
    return 1
}

if [ "$WORKTREE_PATH" = "$MAIN_WORKTREE" ]; then
    WEB_PORT=${VISTA_WEB_PORT:-5173}
    SYNC_PORT=${VISTA_SYNC_PORT:-8788}
else
    PORT_OFFSET=$(($(echo "$WORKTREE_PATH" | cksum | awk '{print $1}') % 100))

    if [ -n "$VISTA_WEB_PORT" ]; then
        WEB_PORT=$VISTA_WEB_PORT
    else
        PREFERRED_WEB_PORT=$((5173 + PORT_OFFSET))
        WEB_PORT=$(find_available_port $PREFERRED_WEB_PORT 5173 5272)
        if [ "$WEB_PORT" != "$PREFERRED_WEB_PORT" ]; then
            echo "   i Port $PREFERRED_WEB_PORT in use, using $WEB_PORT for web"
        fi
    fi

    if [ -n "$VISTA_SYNC_PORT" ]; then
        SYNC_PORT=$VISTA_SYNC_PORT
    else
        PREFERRED_SYNC_PORT=$((8788 + PORT_OFFSET))
        SYNC_PORT=$(find_available_port $PREFERRED_SYNC_PORT 8788 8887)
        if [ "$SYNC_PORT" != "$PREFERRED_SYNC_PORT" ]; then
            echo "   i Port $PREFERRED_SYNC_PORT in use, using $SYNC_PORT for sync"
        fi
    fi
fi

DEV_HOST=${VISTA_DEV_HOST:-127.0.0.1}

echo "[dev] Vista worktree environment"
echo "[dev] Worktree: $WORKTREE_PATH"
echo "[dev] Main:     $MAIN_WORKTREE"
echo "[dev] Web:      http://$DEV_HOST:$WEB_PORT"
echo "[dev] Sync:     http://$DEV_HOST:$SYNC_PORT"

if [ "$WORKTREE_PATH" != "$MAIN_WORKTREE" ] && [ ! -f "$SEEDED_MARKER" ] && [ ! -f "$SKIP_SEED_MARKER" ] && [ -d "$MAIN_WORKTREE/$STATE_DIR" ]; then
    echo "[dev] Seeding local worker state from main worktree"
    mkdir -p "$(dirname "$STATE_DIR")"
    cp -R "$MAIN_WORKTREE/$STATE_DIR" "$STATE_DIR"
    echo "Seeded from $MAIN_WORKTREE on $(date)" > "$SEEDED_MARKER"
    echo "[dev] State copied into $STATE_DIR"
elif [ "$WORKTREE_PATH" != "$MAIN_WORKTREE" ] && [ -f "$SKIP_SEED_MARKER" ]; then
    echo "[dev] Keeping fresh local worker state without re-seeding from main"
elif [ "$WORKTREE_PATH" = "$MAIN_WORKTREE" ]; then
    echo "[dev] Running in main worktree"
elif [ ! -d "$MAIN_WORKTREE/$STATE_DIR" ]; then
    echo "[dev] Main worktree has no local worker state yet; starting from an empty database"
fi

if [ "$WORKTREE_PATH" != "$MAIN_WORKTREE" ]; then
    if [ -L .env.local ] && [ ! -e .env.local ]; then
        echo "[dev] Recreating broken .env.local symlink"
        rm .env.local
    fi

    if [ ! -e .env.local ] && [ -f "$MAIN_WORKTREE/.env.local" ]; then
        echo "[dev] Linking .env.local from main worktree"
        ln -sf "$MAIN_WORKTREE/.env.local" .env.local
    fi
fi

export VISTA_WEB_PORT=$WEB_PORT
export VISTA_SYNC_PORT=$SYNC_PORT
export VISTA_DEV_HOST=$DEV_HOST

echo ""
echo "[dev] Starting services"
echo ""

bun run dev
