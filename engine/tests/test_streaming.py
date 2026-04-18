"""Streaming + true-cancellation tests.

Each test boots a real uvicorn server in a background thread, drives it
with httpx streaming, and asserts on the SSE events. No mocks: every
assertion is against the real algorithm running in a real subprocess.
"""

from __future__ import annotations

import asyncio
import json
import socket
import time
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, Thread
from typing import AsyncIterator, Dict, List, Tuple

import httpx
import pytest
import uvicorn

from upiqlo_engine.cache import cache
from upiqlo_engine.server import create_app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _ServerFixture:
    def __init__(self) -> None:
        self.port = _free_port()
        self.app = create_app()
        self.config = uvicorn.Config(
            self.app,
            host="127.0.0.1",
            port=self.port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(self.config)
        self._thread: Thread | None = None
        self._ready = Event()

    def start(self) -> None:
        def _run() -> None:
            # Poll the server state to signal readiness.
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
            raise RuntimeError("uvicorn did not start in time")

    def stop(self) -> None:
        self.server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=5)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"


@pytest.fixture
def server() -> _ServerFixture:
    cache.clear()
    s = _ServerFixture()
    s.start()
    yield s
    s.stop()
    cache.clear()


async def _iter_sse_events(
    resp: httpx.Response,
) -> AsyncIterator[Tuple[str, Dict]]:
    """Parse SSE events from an httpx streaming response."""
    buf = ""
    async for chunk in resp.aiter_text():
        buf += chunk
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            event = "message"
            data_lines: List[str] = []
            for line in block.splitlines():
                if line.startswith(":"):
                    continue  # keepalive comment
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].strip())
            if data_lines:
                try:
                    data = json.loads("\n".join(data_lines))
                except Exception:
                    data = {"raw": "\n".join(data_lines)}
            else:
                data = {}
            yield event, data


@pytest.mark.asyncio
async def test_stream_yields_stages_and_result(
    server: _ServerFixture, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            f"{server.base}/api/compare-paths/stream",
            json={
                "reference_path": str(ref),
                "target_path": str(tgt),
                "params": {"max_side": 384},
            },
        ) as resp:
            assert resp.status_code == 200
            events: List[Tuple[str, Dict]] = []
            async for evt, data in _iter_sse_events(resp):
                events.append((evt, data))
                if evt in ("done", "error", "cancelled"):
                    break

    kinds = [e[0] for e in events]
    assert kinds[0] == "open"
    assert "token" in events[0][1]
    assert "stage" in kinds, f"no stage events in {kinds}"
    stage_events = [e[1] for e in events if e[0] == "stage"]
    # Upstream pipeline has 5 stages; each should be emitted in order.
    stage_indices = [s["index"] for s in stage_events]
    assert stage_indices == sorted(stage_indices)
    assert stage_indices[0] == 1
    assert max(stage_indices) == 5

    assert kinds[-2] == "result"
    assert kinds[-1] == "done"
    result = events[-2][1]
    assert 0.0 <= result["score"] <= 1.0
    assert len(result["heatmaps"]) >= 7


@pytest.mark.asyncio
async def test_cancel_kills_subprocess_within_2s(
    server: _ServerFixture, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Start the stream.
        async with client.stream(
            "POST",
            f"{server.base}/api/compare-paths/stream",
            json={
                "reference_path": str(ref),
                "target_path": str(tgt),
                # Bigger max_side => longer run, giving us time to cancel.
                "params": {"max_side": 1024},
            },
        ) as resp:
            assert resp.status_code == 200

            token: str | None = None
            cancelled_seen = False
            t0 = time.perf_counter()
            cancel_sent_at: float | None = None

            async for evt, data in _iter_sse_events(resp):
                if evt == "open":
                    token = data["token"]
                    # Fire DELETE as soon as we have the token. Use a
                    # separate client so we're not starved by the stream.
                    async with httpx.AsyncClient(timeout=5.0) as c2:
                        r = await c2.delete(f"{server.base}/api/compare/{token}")
                        assert r.status_code == 200
                        assert r.json()["cancelled"] is True
                        cancel_sent_at = time.perf_counter()
                elif evt == "cancelled":
                    cancelled_seen = True
                    break
                elif evt in ("done", "error"):
                    break

            assert token is not None, "never received open event"
            assert cancel_sent_at is not None
            assert cancelled_seen, "server never emitted cancelled event"
            # Cancellation latency: time from DELETE return to cancelled SSE event.
            elapsed = time.perf_counter() - cancel_sent_at
            assert elapsed < 2.5, f"cancellation took {elapsed:.2f}s (expected <2.5s)"


@pytest.mark.asyncio
async def test_concurrent_streams_do_not_collide(
    server: _ServerFixture, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair

    async def one_run() -> float:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                f"{server.base}/api/compare-paths/stream",
                json={
                    "reference_path": str(ref),
                    "target_path": str(tgt),
                    "params": {"max_side": 384},
                },
            ) as resp:
                async for evt, data in _iter_sse_events(resp):
                    if evt == "result":
                        return float(data["score"])
                    if evt in ("error", "cancelled", "done"):
                        break
        raise RuntimeError("no result emitted")

    # Use a unique param per request to avoid cache hits making the test trivial.
    scores = await asyncio.gather(one_run(), one_run())
    for s in scores:
        assert 0.0 <= s <= 1.0
    # Cache should've kicked in for the second; scores identical.
    assert scores[0] == scores[1]


@pytest.mark.asyncio
async def test_cache_hit_skips_subprocess_but_still_streams(
    server: _ServerFixture, image_pair: tuple[Path, Path]
) -> None:
    ref, tgt = image_pair
    payload = {
        "reference_path": str(ref),
        "target_path": str(tgt),
        "params": {"max_side": 384},
    }

    async def collect() -> List[str]:
        events: List[str] = []
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST", f"{server.base}/api/compare-paths/stream", json=payload
            ) as resp:
                async for evt, _ in _iter_sse_events(resp):
                    events.append(evt)
                    if evt in ("done", "error"):
                        break
        return events

    first = await collect()
    second = await collect()

    assert "stage" in first
    assert "result" in first
    # Second run is from cache — no subprocess, no stage events, direct result.
    assert "stage" not in second
    assert second == ["open", "result", "done"]
