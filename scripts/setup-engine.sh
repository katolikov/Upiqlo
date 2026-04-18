#!/usr/bin/env bash
# Bootstraps engine/.venv with Python 3.11 via uv and installs CPU torch wheels.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/engine"

if ! command -v uv >/dev/null; then
  echo "uv not found. Install from https://docs.astral.sh/uv/"
  exit 1
fi

uv python install 3.11
uv venv -p 3.11 .venv
# shellcheck disable=SC1091
source .venv/bin/activate
uv pip install -r requirements-dev.txt

# Dev-loop convenience: install the algorithm from the sibling repo.
ALGO_REPO="${UPIQLO_ALGO_REPO:-$ROOT/../FR-IQA-Algo}"
if [[ -d "$ALGO_REPO" ]]; then
  echo "Installing upiqal from $ALGO_REPO (editable)"
  uv pip install -e "$ALGO_REPO"
else
  echo "FR-IQA-Algo repo not found at $ALGO_REPO; skipping editable install."
  echo "Set UPIQLO_ALGO_REPO=<path> to override."
fi

echo
echo "Engine venv ready. Activate with: source engine/.venv/bin/activate"
