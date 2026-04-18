#!/usr/bin/env bash
# Launches the engine + ui + tauri dev host in one terminal.
# Engine runs on a fixed port + fixed token so the UI's dev fallback can
# find them without going through the Tauri handshake (which isn't active
# in vite-only dev).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -d engine/.venv ]]; then
  echo "engine/.venv missing. Run: ./scripts/setup-engine.sh"
  exit 1
fi

# Port + token are generated fresh per dev session unless already set.
export UPIQLO_ENGINE_PORT_OVERRIDE="${UPIQLO_ENGINE_PORT_OVERRIDE:-51017}"
if [[ -z "${UPIQLO_ENGINE_TOKEN_OVERRIDE:-}" ]]; then
  UPIQLO_ENGINE_TOKEN_OVERRIDE=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
  export UPIQLO_ENGINE_TOKEN_OVERRIDE
fi

# Vite reads these at dev-server start so the browser UI can authenticate
# against the engine without going through the (non-existent) Tauri bridge.
export VITE_UPIQLO_ENGINE_PORT="$UPIQLO_ENGINE_PORT_OVERRIDE"
export VITE_UPIQLO_ENGINE_TOKEN="$UPIQLO_ENGINE_TOKEN_OVERRIDE"

cleanup() {
  echo
  echo "[dev.sh] shutting down…"
  [[ -n "${ENGINE_PID:-}" ]] && kill "$ENGINE_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev.sh] starting engine on port $UPIQLO_ENGINE_PORT_OVERRIDE"
(cd engine && .venv/bin/python -m upiqlo_engine) &
ENGINE_PID=$!

echo "[dev.sh] starting tauri dev (spawns vite internally)"
npm run tauri:dev
