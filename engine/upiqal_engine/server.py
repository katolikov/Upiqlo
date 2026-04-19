"""FastAPI application for the Upiqal engine.

Endpoints
---------
GET  /healthz                        — liveness + algorithm-availability probe.
POST /api/compare                    — single-pair comparison (multipart upload).
POST /api/compare-paths              — single-pair comparison by absolute paths.
POST /api/compare-paths/stream       — same as above, SSE stream of stages + result.
DELETE /api/compare/{token}          — mark an in-flight streamed run as cancelled.
POST /api/folders/scan               — scan two directories, return paired files.
POST /api/folders/compare            — run one pair within a folder session.
GET  /api/report/{session_id}/{pair} — retrieve a cached result.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import __version__
from .cache import cache
from .folders import FolderScan, PairingMode, scan as folders_scan
from .params import CompareParams, HealthResponse
from .pipeline import CompareResult, run_compare

log = logging.getLogger(__name__)


def _algorithm_available() -> bool:
    """Check that the vendored ``upiqal`` package imports successfully."""
    try:
        from .pipeline import _setup_upstream

        _setup_upstream()
        return True
    except Exception as exc:
        log.warning("Algorithm not available: %s", exc)
        return False


# ---------------------------------------------------------------------------
# Bearer-token auth (the "strictly internal hidden bridge" guarantee)
# ---------------------------------------------------------------------------


def _expected_token() -> Optional[str]:
    """The token is set as an env var by __main__.py at startup."""
    return os.environ.get("UPIQAL_ENGINE_TOKEN")


async def require_token(
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
    auth_token_qs: Optional[str] = Query(default=None, alias="token"),
) -> None:
    """Require the bearer token on every /api/* route.

    Accepts the token in either:
      * ``Authorization: Bearer <token>`` — normal fetch flows.
      * ``?token=<token>`` — EventSource (SSE) from the webview, because
        ``new EventSource(url)`` can't set custom headers.
    """
    expected = _expected_token()
    if not expected:
        # If no token was configured (e.g. pytest standalone) allow through.
        # When the engine is started via __main__.py, a token is always set.
        return
    supplied: Optional[str] = None
    if authorization:
        parts = authorization.split(None, 1)
        if len(parts) == 2 and parts[0].lower() == "bearer":
            supplied = parts[1].strip()
    if supplied is None and auth_token_qs is not None:
        supplied = auth_token_qs
    if supplied != expected:
        raise HTTPException(status_code=401, detail="invalid or missing engine token")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ComparePathsRequest(BaseModel):
    reference_path: str
    target_path: str
    session_id: Optional[str] = None
    pair_id: Optional[str] = None
    params: CompareParams = Field(default_factory=CompareParams)


class FolderScanRequest(BaseModel):
    reference_dir: str
    target_dir: str
    mode: PairingMode = "filename"


class FolderCompareRequest(BaseModel):
    session_id: str
    pair_id: str
    reference_path: str
    target_path: str
    params: CompareParams = Field(default_factory=CompareParams)


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app() -> FastAPI:
    app = FastAPI(title="Upiqal Engine", version=__version__)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "tauri://localhost",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS", "DELETE"],
        allow_headers=["*"],
    )

    # ---------- Liveness ----------
    @app.get("/healthz", response_model=HealthResponse)
    async def healthz() -> HealthResponse:
        return HealthResponse(
            version=__version__,
            algorithm_available=_algorithm_available(),
        )

    # ---------- Single-pair compare (multipart) ----------
    @app.post("/api/compare", dependencies=[Depends(require_token)])
    async def api_compare(
        reference_image: UploadFile = File(...),
        target_image: UploadFile = File(...),
        max_side: int = Form(1024),
        score_mode: str = Form("sigmoid"),
        pyramid: bool = Form(True),
        feature_side: int = Form(256),
        session_id: Optional[str] = Form(None),
        pair_id: Optional[str] = Form(None),
    ) -> dict:
        params = CompareParams(
            max_side=max_side,
            score_mode=score_mode,  # type: ignore[arg-type]
            pyramid=pyramid,
            feature_side=feature_side,
        )
        # Persist uploads to a temp dir so the pipeline can read them as
        # files (upiqal_cli.run_pipeline takes paths, not in-memory buffers).
        with tempfile.TemporaryDirectory(prefix="upiqal_upload_") as td:
            ref_path = Path(td) / (reference_image.filename or "reference.png")
            tgt_path = Path(td) / (target_image.filename or "target.png")
            ref_path.write_bytes(await reference_image.read())
            tgt_path.write_bytes(await target_image.read())

            result = await _run_and_cache(
                str(ref_path),
                str(tgt_path),
                params,
                session_id,
                pair_id,
            )
            return result.to_json()

    # ---------- Single-pair compare (by path) ----------
    @app.post("/api/compare-paths", dependencies=[Depends(require_token)])
    async def api_compare_paths(req: ComparePathsRequest) -> dict:
        result = await _run_and_cache(
            req.reference_path,
            req.target_path,
            req.params,
            req.session_id,
            req.pair_id,
        )
        return result.to_json()

    # ---------- Single-pair compare, streamed ----------
    @app.post("/api/compare-paths/stream", dependencies=[Depends(require_token)])
    async def api_compare_paths_stream(
        req: ComparePathsRequest, request: Request
    ) -> StreamingResponse:
        _remember_path(req.reference_path, req.target_path)
        return StreamingResponse(
            _stream_compare(req, request),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",  # disable any proxy buffering
            },
        )

    # ---------- Cancel a streamed run ----------
    @app.delete("/api/compare/{token}", dependencies=[Depends(require_token)])
    async def api_compare_cancel(token: str) -> dict:
        cancelled = await _cancel_run(token)
        return {"cancelled": cancelled, "token": token}

    # ---------- Folder scan ----------
    @app.post("/api/folders/scan", dependencies=[Depends(require_token)])
    async def api_folders_scan(req: FolderScanRequest) -> dict:
        try:
            result: FolderScan = folders_scan(
                req.reference_dir, req.target_dir, req.mode
            )
        except FileNotFoundError as e:
            raise HTTPException(status_code=400, detail=str(e))
        for p in result.pairs:
            _remember_path(p.reference_path, p.target_path)
        for p in result.unmatched_reference:
            _remember_path(p)
        for p in result.unmatched_target:
            _remember_path(p)
        return result.to_json()

    # ---------- Folder pair compare ----------
    @app.post("/api/folders/compare", dependencies=[Depends(require_token)])
    async def api_folders_compare(req: FolderCompareRequest) -> dict:
        result = await _run_and_cache(
            req.reference_path,
            req.target_path,
            req.params,
            req.session_id,
            req.pair_id,
        )
        return result.to_json()

    # ---------- Cached report ----------
    @app.get("/api/report/{session_id}/{pair_id}", dependencies=[Depends(require_token)])
    async def api_report(session_id: str, pair_id: str) -> dict:
        r = cache.get_by_session(session_id, pair_id)
        if r is None:
            raise HTTPException(status_code=404, detail="No cached report for pair")
        return r.to_json()

    # ---------- File passthrough (browser dev fallback) ----------
    # Tauri uses convertFileSrc in production; this endpoint only exists so
    # `npm run dev:ui` can display local images without running the native
    # shell. It only serves files whose paths match ones the session has
    # already legitimately exposed via /api/compare* or /api/folders/scan.
    @app.get("/api/file", dependencies=[Depends(require_token)])
    async def api_file(path: str = Query(...)) -> FileResponse:
        resolved = Path(path).expanduser().resolve()
        if not resolved.is_file():
            raise HTTPException(status_code=404, detail="file not found")
        if not _path_previously_seen(str(resolved)):
            raise HTTPException(
                status_code=403,
                detail="file has not been announced to the engine in this session",
            )
        return FileResponse(resolved)

    return app


# Paths that have been referenced in at least one compare/scan call during
# this process's lifetime. Used by /api/file to decide whether a browser-
# dev fallback passthrough is allowed. This is not a security boundary
# (Tauri doesn't use this endpoint); it just prevents casual browsing.
_known_paths: set[str] = set()


def _remember_path(*paths: str) -> None:
    for p in paths:
        if p:
            try:
                _known_paths.add(str(Path(p).expanduser().resolve()))
            except Exception:
                pass


def _path_previously_seen(path: str) -> bool:
    return path in _known_paths


# ---------------------------------------------------------------------------
# Streaming + TRUE cancellation
# ---------------------------------------------------------------------------
#
# Each streamed comparison runs in a **child Python subprocess** spawned via
# `asyncio.create_subprocess_exec` against `python -m upiqal_engine.subworker`.
# On cancel, DELETE /api/compare/:token looks up the token's process and
# calls `process.kill()` — SIGKILL instantly frees every torch tensor and
# C++ allocator arena the child owned. No lingering CPU/GPU load, no
# "result goes to cache anyway" discard.
#
# The in-process `run_compare` is retained for the non-streaming
# /api/compare-paths and /api/folders/compare endpoints (they're synchronous
# and don't need cancellation semantics) but the streaming path is fully
# subprocess-isolated.
import re as _re  # alias to avoid shadowing `pipeline.py`-imported `re`


@dataclass
class StreamRun:
    token: str
    process: Optional["asyncio.subprocess.Process"] = None
    cancelled: bool = False


_runs: Dict[str, StreamRun] = {}
_runs_lock = asyncio.Lock()


async def _register_run(token: str) -> StreamRun:
    run = StreamRun(token=token)
    async with _runs_lock:
        _runs[token] = run
    return run


async def _unregister_run(token: str) -> None:
    async with _runs_lock:
        _runs.pop(token, None)


async def _cancel_run(token: str) -> bool:
    """SIGKILL the child process associated with ``token``.

    Returns True if a run was found, False otherwise. After kill(), the
    SSE generator's reader will see EOF on the child's stdout and emit a
    ``cancelled`` event back to the client.
    """
    async with _runs_lock:
        run = _runs.get(token)
    if run is None:
        return False
    run.cancelled = True
    proc = run.process
    if proc is None:
        return True  # Process hasn't launched yet; cancelled flag suffices.
    try:
        proc.kill()
    except ProcessLookupError:
        pass  # Already exited.
    return True


def _cancel_token(token: str) -> bool:
    """Synchronous wrapper used by the DELETE handler, which runs in an
    event loop but needs a simple True/False return. Schedules the async
    cancel on the running loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return False
    fut = asyncio.run_coroutine_threadsafe(_cancel_run(token), loop)
    try:
        return fut.result(timeout=2.0)
    except Exception:
        return False


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


_STAGE_RE = _re.compile(r"^\s*\[(\d+)/(\d+)\]\s+(.+?)\s+\.\.\.\s+done")
_RESULT_START = "__UPIQAL_RESULT_START__"
_RESULT_END = "__UPIQAL_RESULT_END__"


async def _stream_compare(
    req: ComparePathsRequest, request: Request
) -> AsyncIterator[str]:
    """SSE generator.

    Yields, in order:
      * one ``open`` event with the cancellation token
      * zero or more ``stage`` events (one per ``[N/M]`` upstream line)
      * optionally one ``result`` event, then ``done`` — on success
      * or ``error`` — on pipeline failure
      * or ``cancelled`` — on client disconnect or DELETE
    """
    token = secrets.token_urlsafe(16)
    run = await _register_run(token)

    _remember_path(req.reference_path, req.target_path)

    # Shortcut: serve from cache without spawning the subprocess.
    params_dict = req.params.model_dump()
    try:
        key = cache.key_for(req.reference_path, req.target_path, params_dict)
    except FileNotFoundError as e:
        yield _sse("open", {"token": token})
        yield _sse("error", {"message": str(e)})
        await _unregister_run(token)
        return
    cached = cache.get(key)
    if cached is not None:
        yield _sse("open", {"token": token})
        yield _sse("result", cached.to_json())
        yield _sse("done", {})
        await _unregister_run(token)
        return

    # Spawn the child. `-u` forces unbuffered stdio so we see stage lines
    # the instant upstream prints them.
    try:
        # Dev vs PyInstaller-bundled dispatch:
        #   - In dev, sys.executable is a python interpreter; use `-m`.
        #   - When frozen by PyInstaller, sys.executable is the bundle; we
        #     re-exec it with a sentinel argv that __main__.py recognises.
        # Absolute import so this also resolves from a PyInstaller bundle
        # where there is no parent package context.
        from upiqal_engine.__main__ import SUBWORKER_SENTINEL

        if getattr(sys, "frozen", False):
            argv_prefix = [sys.executable, SUBWORKER_SENTINEL]
        else:
            argv_prefix = [sys.executable, "-u", "-m", "upiqal_engine.subworker"]
        proc = await asyncio.create_subprocess_exec(
            *argv_prefix,
            "--reference",
            req.reference_path,
            "--target",
            req.target_path,
            "--params-json",
            json.dumps(params_dict),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except Exception as e:
        yield _sse("open", {"token": token})
        yield _sse("error", {"message": f"failed to spawn subworker: {e}"})
        await _unregister_run(token)
        return

    run.process = proc

    yield _sse("open", {"token": token})

    if run.cancelled:
        # DELETE arrived between register and spawn.
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        yield _sse("cancelled", {"token": token})
        await _unregister_run(token)
        return

    assert proc.stdout is not None
    assert proc.stderr is not None

    # Drain stderr in a background task so it doesn't back up.
    stderr_buf: List[str] = []

    async def _drain_stderr() -> None:
        try:
            while True:
                line = await proc.stderr.readline()  # type: ignore[union-attr]
                if not line:
                    return
                decoded = line.decode(errors="replace").rstrip()
                if decoded:
                    log.info("[subworker:err] %s", decoded)
                    stderr_buf.append(decoded)
        except Exception:
            return

    stderr_task = asyncio.create_task(_drain_stderr())

    # Main read loop — parse stage lines, harvest the final result block.
    result_lines: List[str] = []
    in_result = False
    result_json: Optional[Dict[str, Any]] = None

    try:
        while True:
            if await request.is_disconnected():
                # Client closed connection. Kill the worker for real.
                try:
                    proc.kill()
                except ProcessLookupError:
                    pass
                yield _sse("cancelled", {"token": token})
                return

            raw = await proc.stdout.readline()
            if not raw:
                # EOF from child. Await exit and classify the outcome.
                rc = await proc.wait()
                if run.cancelled:
                    yield _sse("cancelled", {"token": token})
                    return
                if result_json is not None:
                    # Persist to cache before emitting.
                    from .pipeline import CompareResult

                    cr = CompareResult(
                        score=result_json["score"],
                        score_label=result_json.get("score_label", ""),
                        reference_image=result_json["reference_image"],
                        target_image=result_json["target_image"],
                        image_resolution=result_json.get("image_resolution", {}),
                        diagnostics=result_json.get("diagnostics", {}),
                        heatmaps=result_json.get("heatmaps", {}),
                        params=result_json.get("params", {}),
                    )
                    cache.put(key, cr)
                    if req.session_id and req.pair_id:
                        cache.register_session(req.session_id, req.pair_id, key)
                    yield _sse("result", cr.to_json())
                    yield _sse("done", {})
                    return
                # No result and non-zero exit → error.
                message = (
                    "\n".join(stderr_buf) if stderr_buf else f"subworker exited {rc}"
                )
                yield _sse("error", {"message": message})
                return

            line = raw.decode(errors="replace").rstrip()

            # Result sentinel handling.
            if line == _RESULT_START:
                in_result = True
                result_lines = []
                continue
            if line == _RESULT_END:
                try:
                    result_json = json.loads("".join(result_lines))
                except Exception as e:
                    log.exception("failed to parse subworker result JSON")
                    yield _sse("error", {"message": f"malformed result: {e}"})
                    return
                in_result = False
                continue
            if in_result:
                result_lines.append(line)
                continue

            # Stage progress?
            m = _STAGE_RE.match(line)
            if m:
                stage = {
                    "index": int(m.group(1)),
                    "total": int(m.group(2)),
                    "name": m.group(3).strip(),
                }
                yield _sse("stage", stage)
                continue

            # Other chatty upstream output — log it, don't spam SSE clients.
            if line:
                log.info("[subworker] %s", line)
    finally:
        stderr_task.cancel()
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
        await _unregister_run(token)


async def _run_and_cache(
    ref_path: str,
    tgt_path: str,
    params: CompareParams,
    session_id: Optional[str],
    pair_id: Optional[str],
) -> CompareResult:
    """Shared helper: check cache, run if needed, register with session."""
    _remember_path(ref_path, tgt_path)
    try:
        key = cache.key_for(ref_path, tgt_path, params.model_dump())
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cached = cache.get(key)
    if cached is not None:
        log.info("cache hit for %s / %s", ref_path, tgt_path)
        if session_id and pair_id:
            cache.register_session(session_id, pair_id, key)
        return cached

    # The upstream pipeline is CPU-heavy (~2 s per pair at 256 px). Run it
    # in a thread so the event loop can continue serving other requests.
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, run_compare, ref_path, tgt_path, params)
    cache.put(key, result)
    if session_id and pair_id:
        cache.register_session(session_id, pair_id, key)
    return result


app = create_app()
