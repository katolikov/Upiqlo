"""Build the ``upiqlo-engine`` PyInstaller sidecar for the current host.

Produces ``dist/upiqlo-engine-<rust-target-triple>/`` in one-dir mode (the
whole folder is bundled by Tauri via ``externalBin`` + ``resources``).

Usage:
    python scripts/build_sidecar.py [--target <triple>]

If ``--target`` is omitted, the Rust host triple is auto-detected via
``rustc -vV``. The output dir is renamed to match Tauri's sidecar naming
convention so that ``tauri.conf.json``'s ``externalBin`` entry resolves.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent
SPEC_FILE = ENGINE_DIR / "upiqlo-engine.spec"


def rustc_host_triple() -> str:
    out = subprocess.check_output(["rustc", "-vV"], text=True)
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("Could not parse rustc host triple")


def build(target: str) -> None:
    # 1. Vendor the algorithm + weights (idempotent).
    subprocess.check_call(
        [sys.executable, str(ENGINE_DIR / "scripts" / "vendor_algorithm.py")],
        cwd=ENGINE_DIR,
    )

    # 2. PyInstaller build.
    dist_dir = ENGINE_DIR / "dist"
    build_dir = ENGINE_DIR / "build"
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
    if build_dir.exists():
        shutil.rmtree(build_dir)

    subprocess.check_call(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            str(SPEC_FILE),
        ],
        cwd=ENGINE_DIR,
    )

    # 3. Rename one-dir output to Tauri's sidecar convention.
    src = dist_dir / "upiqlo-engine"
    dst = dist_dir / f"upiqlo-engine-{target}"
    if not src.is_dir():
        raise SystemExit(f"Expected PyInstaller output at {src}; not found")
    if dst.exists():
        shutil.rmtree(dst)
    src.rename(dst)
    print(f"Sidecar ready: {dst}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--target",
        default=None,
        help="Rust target triple (e.g. aarch64-apple-darwin). Defaults to host.",
    )
    args = p.parse_args()
    target = args.target or rustc_host_triple()
    build(target)


if __name__ == "__main__":
    main()
