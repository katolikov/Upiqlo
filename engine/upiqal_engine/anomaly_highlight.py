"""Post-process step: produce a grayscale-background + colour-highlighted
anomaly view.

Pipeline output already includes ``global_anomaly_map.png`` (a normalised
anomaly score per pixel, brighter = more anomalous) and
``anomaly_overlay.png`` (target blended with a jet colourmap). This module
derives a third image, ``anomaly_highlight.png``, where the *unchanged*
image context is rendered in monochrome and only the anomalous regions
keep their original colour. Result is far easier to read than either of
the two existing outputs.

Algorithm
---------
1. Read the target image at its rendering resolution (same as the other
   outputs, so the result lines up with ``global_anomaly_map.png``).
2. Compute per-pixel luminance (Rec.601) and fan it out to a 3-channel
   grayscale image.
3. Treat ``global_anomaly_map.png`` as the alpha mask in [0, 1].
4. Clamp mask below a floor (avoids haze in boring regions) and stretch
   the remainder to [0, 1] so real anomalies stay vivid.
5. Blend:  out = m * original + (1 - m) * gray

Everything uses PIL + NumPy only; no torch needed here.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def _load_rgb(path: Path, size: tuple[int, int] | None = None) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    if size is not None and img.size != size:
        img = img.resize(size, Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def _load_mask(path: Path, size: tuple[int, int]) -> np.ndarray:
    """The anomaly map on disk is an RGB-ish PNG (jet-coloured). We collapse
    it to a single-channel brightness signal and treat that as the mask."""
    img = Image.open(path).convert("RGB")
    if img.size != size:
        img = img.resize(size, Image.BICUBIC)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    # Luminance-weighted max: the jet colormap's peak intensity reliably
    # corresponds to anomaly strength, independent of the hue.
    lum = 0.2989 * arr[..., 0] + 0.5870 * arr[..., 1] + 0.1140 * arr[..., 2]
    hue_peak = arr.max(axis=-1)
    return np.maximum(lum, hue_peak)


def generate_highlight(
    target_path: Path,
    anomaly_map_path: Path,
    out_path: Path,
    *,
    floor: float = 0.18,
    gamma: float = 0.8,
) -> bool:
    """Write ``out_path`` and return True on success. Silent no-op (returns
    False) if the required inputs are missing, so the caller can proceed
    with the standard heatmap set."""
    if not target_path.is_file() or not anomaly_map_path.is_file():
        return False

    # Match the mask's resolution — that's the pipeline's working size.
    mask_img = Image.open(anomaly_map_path).convert("RGB")
    size = mask_img.size  # (W, H)

    target = _load_rgb(target_path, size=size)
    mask = _load_mask(anomaly_map_path, size=size)

    # Floor + rescale so real anomalies remain bright and flat regions fall
    # fully to the grayscale side.
    mask = np.clip((mask - floor) / max(1e-6, 1.0 - floor), 0.0, 1.0)
    if gamma != 1.0:
        mask = np.power(mask, gamma)

    # Grayscale version of target, broadcast to 3 channels.
    lum = 0.2989 * target[..., 0] + 0.5870 * target[..., 1] + 0.1140 * target[..., 2]
    gray = np.stack([lum, lum, lum], axis=-1)

    m3 = mask[..., None]
    blended = m3 * target + (1.0 - m3) * gray
    out = np.clip(blended * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(out, mode="RGB").save(out_path, format="PNG")
    return True
