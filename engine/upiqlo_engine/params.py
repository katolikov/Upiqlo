"""Pydantic models describing the engine's request/response payloads.

These are intentionally decoupled from the upstream UPIQAL pipeline: the
engine is the only component that should know how to translate between the
wire format (what the UI sends) and the algorithm's native parameters.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ScoreMode = Literal["sigmoid", "nll"]
# Upstream (upiqal_cli.py) accepts exactly these raw pixel formats:
PixelFormat = Literal["NV21", "NV12", "GRAY8", "RGB888"]


class CompareParams(BaseModel):
    """Parameters that can be tuned per-comparison from the UI top bar."""

    max_side: int = Field(1024, ge=256, le=2048)
    score_mode: ScoreMode = "sigmoid"
    pyramid: bool = True
    feature_side: int = Field(256, ge=128, le=512)
    # RAW inputs (.raw/.bin/.yuv) require width + height + pixel_format.
    # For PNG/JPG/TIFF/BMP/WebP/NPY these are auto-detected and must be
    # omitted. .nv21/.nv12 derive pixel_format from their extension.
    width: Optional[int] = None
    height: Optional[int] = None
    pixel_format: Optional[PixelFormat] = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    algorithm_available: bool
