"""Wrapper around the upstream UPIQAL pipeline.

Strategy
--------
The upstream ``upiqal_cli.run_pipeline`` is the single source of truth for
how the 5 modules are assembled, which calibration constants are applied,
and which post-hoc fixes (baseline subtraction, HF-energy discriminator,
etc.) are layered on top. Rather than reimplementing that logic here, the
engine invokes ``run_pipeline`` into a temporary directory per request,
reads ``report.json`` + the heatmap PNGs, and streams them back to the
Tauri webview as a single JSON response.

Advantages:
  * Zero drift from upstream: any calibration fix the algorithm author
    ships in ``FR-IQA-Algo/upiqal_cli.py`` flows through automatically the
    next time the sidecar is rebuilt.
  * No duplicate tensor-orchestration code to maintain in the desktop
    repo; the engine stays focused on I/O + transport concerns.

The ``vendor_algorithm.py`` step places both the ``upiqal`` package and
``upiqal_cli.py`` on the engine's import path (see :func:`_setup_upstream`).
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import io
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .params import CompareParams

# Serialise pipeline invocations: upstream uses plain `print()` which writes
# to a process-global sys.stdout, so we cannot redirect per-thread. The
# model is CPU-bound on a single torch thread anyway, so serialising costs
# nothing.
_pipeline_lock = threading.Lock()

# Regex for the progress lines printed by upstream run_pipeline:
#   "[1/5] Normalization       ... done (0.02s)"
#   "[2/5] Chromatic Transport ... done (0.28s)"
_STAGE_RE = re.compile(r"^\s*\[(\d+)/(\d+)\]\s+(.+?)\s+\.\.\.\s+done")

StageCallback = Callable[["PipelineStage"], None]


@dataclass
class PipelineStage:
    """A single pipeline-stage event, emitted as soon as the line is printed."""

    index: int
    total: int
    name: str
    raw_line: str

    def to_json(self) -> Dict[str, Any]:
        return {
            "index": self.index,
            "total": self.total,
            "name": self.name,
        }


class _LineSplitStream(io.TextIOBase):
    """A writable stream that calls a callback for every complete line."""

    def __init__(self, on_line: Callable[[str], None]) -> None:
        self._buf = ""
        self._on_line = on_line

    def write(self, s: str) -> int:  # type: ignore[override]
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            stripped = line.rstrip()
            if stripped:
                try:
                    self._on_line(stripped)
                except Exception:
                    # Never let a callback error propagate into torch.
                    log.exception("stage callback raised")
        return len(s)

    def flush(self) -> None:  # pragma: no cover
        pass

log = logging.getLogger(__name__)

# Locate the vendored algorithm.
# * In dev: engine/vendor/
# * In a PyInstaller one-dir bundle: ``sys._MEIPASS`` (files declared as
#   `datas` in the .spec land there next to the executable).
_ENGINE_DIR = Path(__file__).resolve().parent.parent


def _vendor_candidates() -> list[Path]:
    bases: list[Path] = [_ENGINE_DIR / "vendor"]
    mei = getattr(sys, "_MEIPASS", None)
    if mei:
        bases.append(Path(mei))
    return bases


_VENDOR_DIR = (_ENGINE_DIR / "vendor")  # Primary (dev) path — preserved
# for legacy call sites like _resolve_uncertainty_weights; runtime
# resolution uses _vendor_candidates() so the bundle is also covered.


def _upstream_cli_candidates() -> list[Path]:
    out: list[Path] = []
    for base in _vendor_candidates():
        out.append(base / "upiqal_cli.py")
    # Dev loop convenience: sibling FR-IQA-Algo repo.
    out.append(_ENGINE_DIR.parent.parent / "FR-IQA-Algo" / "upiqal_cli.py")
    return out


def _vendor_weights_paths() -> list[Path]:
    return [base / "weights" for base in _vendor_candidates()]


def _setup_upstream() -> Path:
    """Make ``upiqal`` + ``upiqal_cli`` importable; return the CLI file path."""
    # Prepend every candidate base (vendor/, sys._MEIPASS/) to sys.path
    # *before* attempting the import. We do this even if the first import
    # succeeds so that upiqal_cli.py (which lives next to the package) is
    # also reachable.
    for base in _vendor_candidates():
        if base.is_dir() and str(base) not in sys.path:
            sys.path.insert(0, str(base))

    try:
        import upiqal  # noqa: F401
    except Exception as exc:
        raise RuntimeError(
            f"upiqal not importable. Run engine/scripts/vendor_algorithm.py. "
            f"Underlying error: {exc}"
        ) from exc

    tried: list[str] = []
    for candidate in _upstream_cli_candidates():
        tried.append(str(candidate))
        if candidate.is_file():
            parent = str(candidate.parent)
            if parent not in sys.path:
                sys.path.insert(0, parent)
            return candidate

    raise RuntimeError(
        "upiqal_cli.py not found. Tried: "
        + "; ".join(tried)
        + f". _MEIPASS={getattr(sys, '_MEIPASS', None)}"
    )


@dataclass
class CompareResult:
    """Result of a single image-pair comparison, ready for JSON serialisation."""

    score: float
    score_label: str
    reference_image: str
    target_image: str
    image_resolution: Dict[str, int]
    diagnostics: Dict[str, Any]
    # Base64-encoded PNG bytes keyed by heatmap name.
    heatmaps: Dict[str, str] = field(default_factory=dict)
    # Echo the params used (for UI display / caching).
    params: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> Dict[str, Any]:
        return {
            "score": self.score,
            "score_label": self.score_label,
            "reference_image": self.reference_image,
            "target_image": self.target_image,
            "image_resolution": self.image_resolution,
            "diagnostics": self.diagnostics,
            "heatmaps": self.heatmaps,
            "params": self.params,
        }


# Heatmap file names produced by upiqal_cli.run_pipeline. Stable across
# versions — see save_channel call sites in upiqal_cli.py.
_HEATMAP_FILES = [
    "color_degradation_map.png",
    "structural_similarity_map.png",
    "global_anomaly_map.png",
    # Upstream commit a611d41 dropped `jpeg_blocking_mask.png` from the
    # PNG output list (the detector still runs; severity is reported in
    # the JSON report's `severity_scores.blocking` field).
    "gibbs_ringing_mask.png",
    "gaussian_noise_mask.png",
    "blur_mask.png",
    "anomaly_overlay.png",
    # Unified diagnostic overlay — all artefact channels on one image.
    "diagnostic_overlay.png",
    # Grayscale-background + colour-highlighted anomaly, produced by
    # upiqlo_engine.anomaly_highlight after the upstream pipeline finishes.
    "anomaly_highlight.png",
]


def _build_args(
    reference_path: str,
    target_path: str,
    output_dir: Path,
    params: CompareParams,
) -> argparse.Namespace:
    """Construct the Namespace expected by upstream ``run_pipeline``."""
    return argparse.Namespace(
        reference=reference_path,
        target=target_path,
        output_dir=str(output_dir),
        name="upiqlo",
        max_side=params.max_side,
        score_mode=params.score_mode,
        pyramid=params.pyramid,
        feature_side=params.feature_side,
        output_format="png",
        width=params.width or 0,
        height=params.height or 0,
        pixel_format=params.pixel_format or "RGB888",
        uncertainty_weights=_resolve_uncertainty_weights(),
        aggregation_weights=None,
    )


def _resolve_uncertainty_weights() -> Optional[str]:
    """Return the path to ``L_cholesky_blockdiag.pth`` if available."""
    env = os.environ.get("UPIQAL_UNCERTAINTY_WEIGHTS")
    if env and Path(env).is_file():
        return env
    for wdir in _vendor_weights_paths():
        p = wdir / "L_cholesky_blockdiag.pth"
        if p.is_file():
            return str(p)
    return None


def _call_run_pipeline(
    args: argparse.Namespace,
    stage_callback: Optional[StageCallback] = None,
) -> None:
    """Invoke ``upiqal_cli.run_pipeline`` with stdout routed to our logger.

    If ``stage_callback`` is supplied, it is called once per ``[N/M] Name``
    progress line emitted by upstream — enabling SSE streaming. The lock
    serialises pipeline invocations so concurrent requests don't share
    stdout redirection state.
    """
    _setup_upstream()
    import upiqal_cli  # type: ignore[import-not-found]

    def _on_line(line: str) -> None:
        log.info("upiqal_cli: %s", line)
        if stage_callback is not None:
            m = _STAGE_RE.match(line)
            if m:
                stage_callback(
                    PipelineStage(
                        index=int(m.group(1)),
                        total=int(m.group(2)),
                        name=m.group(3).strip(),
                        raw_line=line,
                    )
                )

    stream = _LineSplitStream(_on_line)
    with _pipeline_lock, contextlib.redirect_stdout(stream):
        upiqal_cli.run_pipeline(args)


def _encode_png(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _score_label_fallback(score: float) -> str:
    """Keep response self-contained even when upstream omits the label."""
    if score >= 0.90:
        return "Excellent"
    if score >= 0.75:
        return "Good"
    if score >= 0.60:
        return "Fair"
    if score >= 0.45:
        return "Poor"
    return "Bad"


def run_compare(
    reference_path: str,
    target_path: str,
    params: Optional[CompareParams] = None,
    stage_callback: Optional[StageCallback] = None,
) -> CompareResult:
    """Run the UPIQAL pipeline on a pair and return a serialisable result.

    ``stage_callback`` is invoked synchronously (on the pipeline thread) for
    each completed pipeline stage. It must be thread-safe if the caller is
    on a different thread (typical SSE usage: forward to an asyncio queue
    via ``loop.call_soon_threadsafe``).
    """
    params = params or CompareParams()

    ref = Path(reference_path)
    tgt = Path(target_path)
    if not ref.is_file():
        raise FileNotFoundError(f"reference not found: {ref}")
    if not tgt.is_file():
        raise FileNotFoundError(f"target not found: {tgt}")

    with tempfile.TemporaryDirectory(prefix="upiqlo_run_") as td:
        out_dir = Path(td)
        args = _build_args(str(ref), str(tgt), out_dir, params)
        _call_run_pipeline(args, stage_callback=stage_callback)

        report_path = out_dir / "report.json"
        if not report_path.is_file():
            raise RuntimeError(
                f"Pipeline produced no report.json in {out_dir}"
            )
        report = json.loads(report_path.read_text())

        # Derive the grayscale-background + colour-highlighted anomaly.
        # Absolute import so this also resolves inside the PyInstaller bundle.
        from upiqlo_engine.anomaly_highlight import generate_highlight

        try:
            generate_highlight(
                target_path=tgt,
                anomaly_map_path=out_dir / "global_anomaly_map.png",
                out_path=out_dir / "anomaly_highlight.png",
            )
        except Exception:
            log.exception("anomaly_highlight post-process failed")

        heatmaps: Dict[str, str] = {}
        for name in _HEATMAP_FILES:
            p = out_dir / name
            if p.is_file():
                heatmaps[name] = _encode_png(p)

        score = float(report["score"])
        label = report.get("score_label") or _score_label_fallback(score)

        return CompareResult(
            score=score,
            score_label=label,
            reference_image=str(ref),
            target_image=str(tgt),
            image_resolution=report.get("image_resolution", {}),
            diagnostics=report.get("diagnostics", {}),
            heatmaps=heatmaps,
            params=params.model_dump(),
        )


def clear_vendor_cache() -> None:
    """Testing helper: nuke the vendor dir between tests."""
    if _VENDOR_DIR.is_dir():
        shutil.rmtree(_VENDOR_DIR)
