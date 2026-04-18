"""Pydantic models describing the engine's request/response payloads.

These are intentionally decoupled from the upstream UPIQAL pipeline: the
engine is the only component that should know how to translate between the
wire format (what the UI sends) and the algorithm's native parameters.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ScoreMode = Literal["sigmoid", "nll"]
PixelFormat = Literal["RGB888", "RGBA", "NV21", "NV12", "BGR888"]


class CompareParams(BaseModel):
    """Parameters that can be tuned per-comparison from the UI top bar."""

    max_side: int = Field(1024, ge=256, le=2048)
    score_mode: ScoreMode = "sigmoid"
    pyramid: bool = True
    feature_side: int = Field(256, ge=128, le=512)
    # Reserved for RAW inputs (Phase 2+).
    width: Optional[int] = None
    height: Optional[int] = None
    pixel_format: Optional[PixelFormat] = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    algorithm_available: bool
