"""Real end-to-end tests of the pipeline wrapper.

These run the full UPIQAL algorithm on real PNG images from the sibling
FR-IQA-Algo repo. No mocks or synthetic data.
"""

from __future__ import annotations

from pathlib import Path

from upiqal_engine.params import CompareParams
from upiqal_engine.pipeline import run_compare


def test_run_compare_diff_pair(image_pair: tuple[Path, Path]) -> None:
    ref, tgt = image_pair
    # max_side=384 keeps the test under ~3s on CPU while still producing a
    # meaningful score and the full heatmap set.
    result = run_compare(str(ref), str(tgt), CompareParams(max_side=384))

    # Score range check (sigmoid model always returns in [0, 1]).
    assert 0.0 <= result.score <= 1.0
    # Canonical diff test is NOT identical images, so expect non-perfect quality.
    assert result.score < 0.95

    # Standard heatmaps should be present and non-empty. Upstream
    # commit a611d41 dropped `jpeg_blocking_mask.png` (severity still
    # reported in the JSON). The new `diagnostic_overlay.png` is also
    # expected from the same commit.
    expected = {
        "color_degradation_map.png",
        "structural_similarity_map.png",
        "global_anomaly_map.png",
        "gibbs_ringing_mask.png",
        "gaussian_noise_mask.png",
        "blur_mask.png",
        "anomaly_overlay.png",
        "diagnostic_overlay.png",
        "anomaly_highlight.png",  # Upiqal post-processor
    }
    assert expected.issubset(result.heatmaps.keys())
    for name, data in result.heatmaps.items():
        assert len(data) > 0, f"heatmap {name} was empty"

    # Diagnostics shape. Upstream a611d41 dropped `blocking` from the
    # user-visible severity table (still computed internally for the
    # heuristic penalty — the score reflects it).
    diag = result.diagnostics
    assert "dominant_artifact" in diag
    assert "severity_scores" in diag
    for k in ("ringing", "noise", "color_shift", "blur"):
        assert k in diag["severity_scores"]


def test_run_compare_self_scores_high(self_pair: tuple[Path, Path]) -> None:
    """Self-comparison must score near the top of the scale."""
    ref, tgt = self_pair
    result = run_compare(str(ref), str(tgt), CompareParams(max_side=384))
    # The upstream calibration hits ~0.95 on identical images; allow margin.
    assert result.score >= 0.90
    # All severity channels should be essentially zero for a self-comparison.
    sev = result.diagnostics["severity_scores"]
    for ch in ("ringing", "noise", "color_shift", "blur"):
        assert sev[ch] <= 5.0, f"{ch}={sev[ch]} too high for self-comparison"
    assert result.diagnostics["dominant_artifact"] == "None"
