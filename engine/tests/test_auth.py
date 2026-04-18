"""Bearer-token auth tests.

These tests exercise the real require_token dependency with a real token
configured through the UPIQLO_ENGINE_TOKEN env var — no mocks.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from upiqlo_engine.cache import cache
from upiqlo_engine.server import create_app


TOKEN = "test-token-abcdef0123456789"


@pytest.fixture(autouse=True)
def _with_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("UPIQLO_ENGINE_TOKEN", TOKEN)
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_healthz_does_not_require_token(client: TestClient) -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200


def test_api_paths_require_token(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    resp = client.post(
        "/api/compare-paths",
        json={"reference_path": str(ref), "target_path": str(tgt), "params": {"max_side": 384}},
    )
    assert resp.status_code == 401
    assert "token" in resp.json()["detail"].lower()


def test_api_paths_accept_valid_bearer(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    resp = client.post(
        "/api/compare-paths",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"reference_path": str(ref), "target_path": str(tgt), "params": {"max_side": 384}},
    )
    assert resp.status_code == 200
    assert 0.0 <= resp.json()["score"] <= 1.0


def test_api_reject_wrong_token(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    resp = client.post(
        "/api/compare-paths",
        headers={"Authorization": "Bearer not-the-right-token"},
        json={"reference_path": str(ref), "target_path": str(tgt), "params": {"max_side": 384}},
    )
    assert resp.status_code == 401


def test_api_accept_query_token(
    client: TestClient, image_pair: tuple[Path, Path]
) -> None:
    """SSE endpoints can accept the token via ?token=<...>."""
    ref, tgt = image_pair
    # Use /api/folders/scan as a cheap GET-ish POST to test the query param.
    ref_dir = ref.parent
    resp = client.post(
        f"/api/folders/scan?token={TOKEN}",
        json={"reference_dir": str(ref_dir), "target_dir": str(ref_dir), "mode": "filename"},
    )
    assert resp.status_code == 200


def test_cancel_requires_token(client: TestClient) -> None:
    resp = client.delete("/api/compare/some-run-id")
    assert resp.status_code == 401

    resp2 = client.delete(
        "/api/compare/some-run-id",
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    # token-based auth passes; the token happens to be unknown so cancelled=False
    assert resp2.status_code == 200
    assert resp2.json() == {"cancelled": False, "token": "some-run-id"}
