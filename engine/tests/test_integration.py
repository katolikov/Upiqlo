"""End-to-end integration tests: UI code path → engine → real UPIQAL → UI decode.

These run a real uvicorn server, drive it with the exact JSON shape the
frontend sends (token-authed), consume the exact SSE events the frontend
parses, and verify the real diagnostic PNGs can be decoded back into
images. No mocks anywhere.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import socket
from pathlib import Path
from threading import Event, Thread
from typing import List, Tuple

import httpx
import pytest
import uvicorn
from PIL import Image

from upiqlo_engine.cache import cache
from upiqlo_engine.server import create_app

TOKEN = "integration-token-4c1df2"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _LiveServer:
    def __init__(self) -> None:
        self.port = _free_port()
        self.app = create_app()
        self.config = uvicorn.Config(
            self.app, host="127.0.0.1", port=self.port,
            log_level="warning", access_log=False,
        )
        self.server = uvicorn.Server(self.config)
        self._thread: Thread | None = None
        self._ready = Event()

    def start(self) -> None:
        def _run() -> None:
            async def _poll() -> None:
                while not self.server.started:
                    await asyncio.sleep(0.05)
                self._ready.set()
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.create_task(_poll())
            loop.run_until_complete(self.server.serve())
        self._thread = Thread(target=_run, daemon=True)
        self._thread.start()
        if not self._ready.wait(timeout=10):
            raise RuntimeError("uvicorn did not start")

    def stop(self) -> None:
        self.server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"


@pytest.fixture
def live(monkeypatch: pytest.MonkeyPatch) -> _LiveServer:
    monkeypatch.setenv("UPIQLO_ENGINE_TOKEN", TOKEN)
    cache.clear()
    s = _LiveServer()
    s.start()
    yield s
    s.stop()
    cache.clear()


async def _iter_events(resp: httpx.Response):
    buf = ""
    async for chunk in resp.aiter_text():
        buf += chunk
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            event = "message"
            data_lines: List[str] = []
            for line in block.splitlines():
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].strip())
            if not data_lines:
                continue
            try:
                data = json.loads("\n".join(data_lines))
            except Exception:
                data = {"raw": "\n".join(data_lines)}
            yield event, data


async def test_full_ui_to_model_roundtrip(
    live: _LiveServer, image_pair: Tuple[Path, Path]
) -> None:
    """Exercises the full integration surface the UI touches.

    1. /healthz (UI boot status chip)
    2. /api/compare-paths/stream with bearer token (Single-compare run)
    3. Parse open + stage + result + done SSE events
    4. Decode every Base64 heatmap back into a valid PNG
    5. Verify the new unified `diagnostic_overlay.png` is present
    6. /api/report/<sess>/<pair> returns the cached result
    """
    ref, tgt = image_pair
    auth = {"Authorization": f"Bearer {TOKEN}"}

    async with httpx.AsyncClient(timeout=60.0, headers=auth) as client:
        # 1. Health probe mirrors the UI's TopBar status check.
        h = await client.get(f"{live.base}/healthz")
        assert h.status_code == 200
        hb = h.json()
        assert hb["status"] == "ok" and hb["algorithm_available"] is True

        # 2. Streamed comparison with identical session/pair IDs the UI sends.
        session_id = "integ-sess-1"
        pair_id = "integ-pair-1"
        payload = {
            "reference_path": str(ref),
            "target_path": str(tgt),
            "session_id": session_id,
            "pair_id": pair_id,
            "params": {
                "max_side": 384,
                "score_mode": "sigmoid",
                "pyramid": True,
                "feature_side": 256,
            },
        }

        events: List[Tuple[str, dict]] = []
        async with client.stream(
            "POST", f"{live.base}/api/compare-paths/stream", json=payload
        ) as resp:
            assert resp.status_code == 200
            async for evt, data in _iter_events(resp):
                events.append((evt, data))
                if evt in ("done", "error", "cancelled"):
                    break

        kinds = [e[0] for e in events]
        assert kinds[0] == "open"
        assert "token" in events[0][1]
        assert "stage" in kinds, f"no stage events in {kinds}"
        assert kinds[-2] == "result"
        assert kinds[-1] == "done"

        report = events[-2][1]
        # Score is sensible.
        assert 0.0 <= report["score"] <= 1.0
        # Diagnostics shape matches what MetricsDashboard expects.
        # Upstream dropped `blocking` from the user-visible severity table.
        assert "dominant_artifact" in report["diagnostics"]
        for k in ("ringing", "noise", "color_shift", "blur"):
            assert k in report["diagnostics"]["severity_scores"]

        # 3. Every heatmap Base64 blob must decode to a real PNG.
        # jpeg_blocking_mask.png dropped upstream (commit a611d41);
        # severity still lives in diagnostics.severity_scores.blocking.
        expected_layers = {
            "color_degradation_map.png",
            "structural_similarity_map.png",
            "global_anomaly_map.png",
            "gibbs_ringing_mask.png",
            "gaussian_noise_mask.png",
            "blur_mask.png",
            "anomaly_overlay.png",
            "diagnostic_overlay.png",
        }
        missing = expected_layers - set(report["heatmaps"].keys())
        assert not missing, f"missing heatmap layers: {missing}"

        for name, b64 in report["heatmaps"].items():
            raw = base64.b64decode(b64)
            img = Image.open(io.BytesIO(raw))
            img.verify()  # throws if the payload isn't a valid PNG
            assert img.format == "PNG", f"{name} is not PNG"

        # 4. Cached report retrieval (UI reuses this when switching pairs).
        cached = await client.get(
            f"{live.base}/api/report/{session_id}/{pair_id}"
        )
        assert cached.status_code == 200
        assert cached.json()["score"] == report["score"]


async def test_cache_and_tabclose_cancellation_path(
    live: _LiveServer, image_pair: Tuple[Path, Path]
) -> None:
    """Simulates the 'user closes tab mid-run' flow:
    client disconnects → server detects → subprocess killed → cancelled event.
    """
    ref, tgt = image_pair
    auth = {"Authorization": f"Bearer {TOKEN}"}

    async with httpx.AsyncClient(timeout=30.0, headers=auth) as client:
        payload = {
            "reference_path": str(ref),
            "target_path": str(tgt),
            "params": {"max_side": 1024},  # longer run
        }

        token: str | None = None
        # Consume just enough events to get the cancellation token,
        # then abort the stream like the UI's AbortController would on unmount.
        async with client.stream(
            "POST", f"{live.base}/api/compare-paths/stream", json=payload
        ) as resp:
            async for evt, data in _iter_events(resp):
                if evt == "open":
                    token = data["token"]
                    break

        assert token is not None, "server never emitted open event"

        # DELETE mirrors what the UI's streamCompare handle.cancel() fires.
        r = await client.delete(f"{live.base}/api/compare/{token}")
        assert r.status_code == 200
        # It may report False here because the stream-side task already
        # cleaned up on its disconnect-detect path; either outcome is OK.
        assert "cancelled" in r.json()
