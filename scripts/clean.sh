#!/usr/bin/env bash
# Remove all build artifacts; leaves sources and venvs alone.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

rm -rf ui/dist ui/node_modules/.vite
rm -rf src-tauri/target src-tauri/gen src-tauri/binaries
rm -rf engine/build engine/dist engine/vendor
echo "clean complete."
