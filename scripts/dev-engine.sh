#!/usr/bin/env bash
# Run only the Python engine (useful when iterating on UI from the browser
# at http://127.0.0.1:5173/ without the Tauri window).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/engine"

if [[ ! -d .venv ]]; then
  echo "engine/.venv missing. Run: ./scripts/setup-engine.sh"
  exit 1
fi

export UPIQAL_ENGINE_PORT_OVERRIDE="${UPIQAL_ENGINE_PORT_OVERRIDE:-51017}"
if [[ -z "${UPIQAL_ENGINE_TOKEN_OVERRIDE:-}" ]]; then
  UPIQAL_ENGINE_TOKEN_OVERRIDE=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  export UPIQAL_ENGINE_TOKEN_OVERRIDE
fi

echo "[dev-engine.sh] port=$UPIQAL_ENGINE_PORT_OVERRIDE"
echo "[dev-engine.sh] token=$UPIQAL_ENGINE_TOKEN_OVERRIDE"
echo "[dev-engine.sh] export VITE_UPIQAL_ENGINE_PORT / TOKEN for vite"

exec .venv/bin/python -m upiqal_engine
