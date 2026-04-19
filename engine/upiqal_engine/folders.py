"""Folder-compare helpers.

Two modes are supported:

* ``filename``  — pairs files that share a basename (case-insensitive,
  extension-insensitive) across the two directories. Files with no match
  in the other directory are surfaced as ``unmatched_reference`` /
  ``unmatched_target`` so the UI can show them separately.

* ``index``     — pairs files by their position in the sorted listing of
  each directory (1:1 by index). Remaining files on either side are
  surfaced as unmatched.

Both modes skip non-image files and hidden entries.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Literal

PairingMode = Literal["filename", "index"]

IMAGE_EXTS = frozenset(
    {
        # Auto-detected (PIL reads natively): dimensions + format come
        # from the file itself.
        ".png",
        ".jpg",
        ".jpeg",
        ".bmp",
        ".tif",
        ".tiff",
        ".webp",
        # Serialised numpy ndarray — dimensions come from the array.
        ".npy",
        # Raw byte streams — require width/height/pixel_format params.
        # .nv21 / .nv12 also imply pixel_format from extension.
        ".raw",
        ".bin",
        ".yuv",
        ".nv21",
        ".nv12",
    }
)


@dataclass(frozen=True)
class ImagePair:
    reference_path: str
    target_path: str
    label: str  # Human-readable, typically the reference filename.


@dataclass
class FolderScan:
    reference_dir: str
    target_dir: str
    mode: PairingMode
    pairs: List[ImagePair] = field(default_factory=list)
    unmatched_reference: List[str] = field(default_factory=list)
    unmatched_target: List[str] = field(default_factory=list)

    def to_json(self) -> dict:
        return {
            "reference_dir": self.reference_dir,
            "target_dir": self.target_dir,
            "mode": self.mode,
            "pairs": [
                {
                    "reference_path": p.reference_path,
                    "target_path": p.target_path,
                    "label": p.label,
                }
                for p in self.pairs
            ],
            "unmatched_reference": self.unmatched_reference,
            "unmatched_target": self.unmatched_target,
        }


def _list_images(directory: Path) -> List[Path]:
    """Return sorted image files in ``directory`` (non-recursive, no hidden)."""
    if not directory.is_dir():
        raise FileNotFoundError(f"not a directory: {directory}")
    out: List[Path] = []
    for entry in directory.iterdir():
        if entry.name.startswith("."):
            continue
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTS:
            continue
        out.append(entry)
    out.sort(key=lambda p: p.name.lower())
    return out


def _stem_key(path: Path) -> str:
    """Case-insensitive basename stem for filename-mode pairing."""
    return path.stem.lower()


def scan(
    reference_dir: str,
    target_dir: str,
    mode: PairingMode = "filename",
) -> FolderScan:
    """Scan two directories and produce paired + unmatched file lists."""
    ref_dir = Path(reference_dir).expanduser().resolve()
    tgt_dir = Path(target_dir).expanduser().resolve()

    ref_files = _list_images(ref_dir)
    tgt_files = _list_images(tgt_dir)

    result = FolderScan(
        reference_dir=str(ref_dir),
        target_dir=str(tgt_dir),
        mode=mode,
    )

    if mode == "filename":
        tgt_by_stem = {_stem_key(p): p for p in tgt_files}
        matched_target_stems: set[str] = set()
        for r in ref_files:
            key = _stem_key(r)
            t = tgt_by_stem.get(key)
            if t is not None:
                result.pairs.append(
                    ImagePair(reference_path=str(r), target_path=str(t), label=r.name)
                )
                matched_target_stems.add(key)
            else:
                result.unmatched_reference.append(str(r))
        for t in tgt_files:
            if _stem_key(t) not in matched_target_stems:
                result.unmatched_target.append(str(t))

    elif mode == "index":
        n = min(len(ref_files), len(tgt_files))
        for i in range(n):
            r, t = ref_files[i], tgt_files[i]
            result.pairs.append(
                ImagePair(
                    reference_path=str(r),
                    target_path=str(t),
                    label=f"{i + 1:03d}: {r.name} ↔ {t.name}",
                )
            )
        result.unmatched_reference.extend(str(p) for p in ref_files[n:])
        result.unmatched_target.extend(str(p) for p in tgt_files[n:])

    else:
        raise ValueError(f"unknown pairing mode: {mode!r}")

    return result
