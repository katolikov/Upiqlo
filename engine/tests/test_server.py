"""End-to-end HTTP tests for the engine.

No mocks: every test exercises the real UPIQAL pipeline via FastAPI's
TestClient. Fixtures (``image_pair``, ``folder_pair_dirs``) come from
``conftest.py`` and use real PNG files from the sibling FR-IQA-Algo repo.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from upiqlo_engine.cache import cache
from upiqlo_engine.server import create_app


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_healthz_reports_algorithm_available(client: TestClient) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["algorithm_available"] is True


def test_api_compare_multipart_returns_score_and_heatmaps(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    files = {
        "reference_image": (ref.name, io.BytesIO(ref.read_bytes()), "image/png"),
        "target_image": (tgt.name, io.BytesIO(tgt.read_bytes()), "image/png"),
    }
    data = {"max_side": "384"}
    resp = client.post("/api/compare", files=files, data=data)
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert 0.0 <= body["score"] <= 1.0
    assert len(body["heatmaps"]) >= 7
    assert "dominant_artifact" in body["diagnostics"]


def test_api_compare_paths_caches_between_calls(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    payload = {
        "reference_path": str(ref),
        "target_path": str(tgt),
        "params": {"max_side": 384},
    }

    r1 = client.post("/api/compare-paths", json=payload)
    assert r1.status_code == 200
    r2 = client.post("/api/compare-paths", json=payload)
    assert r2.status_code == 200

    # Score must be identical across runs (cache hit returns same object).
    assert r1.json()["score"] == pytest.approx(r2.json()["score"], abs=1e-6)


def test_api_report_roundtrip_via_session(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    payload = {
        "reference_path": str(ref),
        "target_path": str(tgt),
        "session_id": "sess-test",
        "pair_id": "pair-1",
        "params": {"max_side": 384},
    }
    r1 = client.post("/api/compare-paths", json=payload)
    assert r1.status_code == 200

    r2 = client.get("/api/report/sess-test/pair-1")
    assert r2.status_code == 200
    assert r2.json()["score"] == r1.json()["score"]


def test_api_report_404_for_unknown_pair(client: TestClient) -> None:
    assert client.get("/api/report/nope/nope").status_code == 404


def test_api_folders_scan(
    client: TestClient, folder_pair_dirs: tuple[Path, Path]
) -> None:
    ref_dir, tgt_dir = folder_pair_dirs
    resp = client.post(
        "/api/folders/scan",
        json={
            "reference_dir": str(ref_dir),
            "target_dir": str(tgt_dir),
            "mode": "filename",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    labels = sorted(p["label"] for p in body["pairs"])
    assert labels == ["scene_a.png", "scene_b.png"]
    assert any(p.endswith("ref_only.png") for p in body["unmatched_reference"])
    assert any(p.endswith("tgt_only.png") for p in body["unmatched_target"])


def test_api_folders_compare_pair(
    client: TestClient, folder_pair_dirs: tuple[Path, Path]
) -> None:
    ref_dir, tgt_dir = folder_pair_dirs
    resp = client.post(
        "/api/folders/compare",
        json={
            "session_id": "folder-1",
            "pair_id": "scene_a",
            "reference_path": str(ref_dir / "scene_a.png"),
            "target_path": str(tgt_dir / "scene_a.png"),
            "params": {"max_side": 384},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert 0.0 <= body["score"] <= 1.0

    cached = client.get("/api/report/folder-1/scene_a")
    assert cached.status_code == 200
    assert cached.json()["score"] == body["score"]
