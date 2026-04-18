"""Copy the FR-IQA algorithm + weights into engine/vendor/ for distribution.

This script is run:
  * Once per developer during setup (dev loop imports from the sibling repo
    via ``pip install -e ../FR-IQA-Algo`` instead).
  * Always before PyInstaller runs, to bundle the algorithm into the sidecar.

Usage:
    python scripts/vendor_algorithm.py [--algo-repo ../../FR-IQA-Algo]
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

DEFAULT_ALGO_REPO = Path(__file__).resolve().parents[3] / "FR-IQA-Algo"


def vendor(algo_repo: Path, dest: Path) -> None:
    upiqal_src = algo_repo / "upiqal"
    weights_src = algo_repo / "weights"

    if not upiqal_src.is_dir():
        sys.exit(f"ERROR: upiqal package not found at {upiqal_src}")
    if not weights_src.is_dir():
        sys.exit(f"ERROR: weights dir not found at {weights_src}")

    dest.mkdir(parents=True, exist_ok=True)

    upiqal_dest = dest / "upiqal"
    weights_dest = dest / "weights"
    cli_src = algo_repo / "upiqal_cli.py"
    cli_dest = dest / "upiqal_cli.py"

    if upiqal_dest.exists():
        shutil.rmtree(upiqal_dest)
    if weights_dest.exists():
        shutil.rmtree(weights_dest)

    print(f"Copying {upiqal_src} -> {upiqal_dest}")
    shutil.copytree(upiqal_src, upiqal_dest, ignore=shutil.ignore_patterns("__pycache__"))

    print(f"Copying {weights_src} -> {weights_dest}")
    shutil.copytree(weights_src, weights_dest)

    if cli_src.is_file():
        print(f"Copying {cli_src} -> {cli_dest}")
        shutil.copy2(cli_src, cli_dest)
    else:
        print(f"WARNING: {cli_src} not found; subworker will fail at runtime")

    print("Done.")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--algo-repo", type=Path, default=DEFAULT_ALGO_REPO)
    p.add_argument(
        "--dest",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "vendor",
    )
    args = p.parse_args()
    vendor(args.algo_repo.resolve(), args.dest.resolve())


if __name__ == "__main__":
    main()
