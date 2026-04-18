"""Pytest fixtures: real image pairs from the FR-IQA-Algo repo.

No mocks, no synthetic tensors. Tests exercise the full upstream pipeline
against the same files the algorithm authors use for validation.
"""

from __future__ import annotations

from pathlib import Path

import pytest

ALGO_REPO = Path(__file__).resolve().parents[3] / "FR-IQA-Algo"


@pytest.fixture(scope="session")
def algo_repo() -> Path:
    if not ALGO_REPO.is_dir():
        pytest.fail(
            f"FR-IQA-Algo repo not found at {ALGO_REPO}. "
            "Tests require the sibling repo for real image fixtures."
        )
    return ALGO_REPO


@pytest.fixture(scope="session")
def image_pair(algo_repo: Path) -> tuple[Path, Path]:
    """The canonical 'diff test' pair shipped with the algorithm repo."""
    ref = algo_repo / "left.png"
    tgt = algo_repo / "right.png"
    if not ref.is_file() or not tgt.is_file():
        pytest.fail(f"left.png / right.png missing from {algo_repo}")
    return ref, tgt


@pytest.fixture(scope="session")
def self_pair(algo_repo: Path) -> tuple[Path, Path]:
    """Self-comparison: should score near 1.0 and report 'None' dominant."""
    ref = algo_repo / "left.png"
    if not ref.is_file():
        pytest.fail(f"left.png missing from {algo_repo}")
    return ref, ref


@pytest.fixture
def folder_pair_dirs(tmp_path: Path, algo_repo: Path) -> tuple[Path, Path]:
    """Build a pair of throw-away directories with 2 matching images each."""
    ref_dir = tmp_path / "ref"
    tgt_dir = tmp_path / "tgt"
    ref_dir.mkdir()
    tgt_dir.mkdir()

    left = algo_repo / "left.png"
    right = algo_repo / "right.png"

    (ref_dir / "scene_a.png").write_bytes(left.read_bytes())
    (ref_dir / "scene_b.png").write_bytes(left.read_bytes())
    (ref_dir / "ref_only.png").write_bytes(left.read_bytes())

    (tgt_dir / "scene_a.png").write_bytes(right.read_bytes())
    (tgt_dir / "scene_b.png").write_bytes(right.read_bytes())
    (tgt_dir / "tgt_only.png").write_bytes(right.read_bytes())

    return ref_dir, tgt_dir
