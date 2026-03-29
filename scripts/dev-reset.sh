#!/bin/bash

STATE_DIR="apps/web/.wrangler/state"
SEEDED_MARKER="$STATE_DIR/.seeded-from-main"

echo "[dev] Resetting worktree dev environment"

if [ -f "$SEEDED_MARKER" ]; then
    rm "$SEEDED_MARKER"
    echo "[dev] Cleared seed marker"
fi

if [ -d "$STATE_DIR" ]; then
    rm -rf "$STATE_DIR"
    echo "[dev] Removed local worker state"
fi

if [ -L .env.local ]; then
    rm .env.local
    echo "[dev] Removed .env.local symlink"
elif [ -f .env.local ]; then
    echo "[dev] Keeping real .env.local file"
fi

if [ -f apps/web/.dev.vars ]; then
    rm apps/web/.dev.vars
    echo "[dev] Removed apps/web/.dev.vars"
fi

if [ -f apps/sync/.dev.vars ]; then
    rm apps/sync/.dev.vars
    echo "[dev] Removed apps/sync/.dev.vars"
fi

echo ""
echo "[dev] Reset complete"
echo "[dev] Run 'bun run dev:worktree' to re-initialize from main"
