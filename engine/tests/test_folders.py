"""Tests for the folder-compare pairing logic."""

from __future__ import annotations

from pathlib import Path

import pytest

from upiqal_engine.folders import scan


def test_scan_filename_mode_pairs_by_stem(folder_pair_dirs: tuple[Path, Path]) -> None:
    ref_dir, tgt_dir = folder_pair_dirs
    result = scan(str(ref_dir), str(tgt_dir), mode="filename")

    labels = {p.label for p in result.pairs}
    assert labels == {"scene_a.png", "scene_b.png"}

    # Unmatched files surface separately.
    assert any(p.endswith("ref_only.png") for p in result.unmatched_reference)
    assert any(p.endswith("tgt_only.png") for p in result.unmatched_target)


def test_scan_index_mode_pairs_by_position(folder_pair_dirs: tuple[Path, Path]) -> None:
    ref_dir, tgt_dir = folder_pair_dirs
    result = scan(str(ref_dir), str(tgt_dir), mode="index")

    # 3 files in each → 3 pairs; none unmatched.
    assert len(result.pairs) == 3
    assert result.unmatched_reference == []
    assert result.unmatched_target == []

    # Index mode pairs by sort order, not name.
    first = result.pairs[0]
    assert first.reference_path.endswith("ref_only.png")  # ref_only sorts before scene_*
    assert first.target_path.endswith("scene_a.png")


def test_scan_rejects_missing_directory(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        scan(str(tmp_path / "does-not-exist"), str(tmp_path), mode="filename")


def test_scan_ignores_hidden_and_non_image(tmp_path: Path) -> None:
    ref = tmp_path / "ref"
    tgt = tmp_path / "tgt"
    ref.mkdir()
    tgt.mkdir()
    (ref / ".DS_Store").write_bytes(b"junk")
    (ref / "README.txt").write_text("not an image")
    (tgt / ".DS_Store").write_bytes(b"junk")

    result = scan(str(ref), str(tgt), mode="filename")
    assert result.pairs == []
    assert result.unmatched_reference == []
    assert result.unmatched_target == []


def test_scan_unknown_mode_raises(tmp_path: Path) -> None:
    (tmp_path / "a").mkdir()
    (tmp_path / "b").mkdir()
    with pytest.raises(ValueError):
        scan(str(tmp_path / "a"), str(tmp_path / "b"), mode="nonsense")  # type: ignore[arg-type]
