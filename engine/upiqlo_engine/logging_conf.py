"""Centralised logging config for the Upiqlo engine.

Everything is emitted on stderr so that stdout remains reserved for the
``UPIQLO_ENGINE_PORT=<n>`` handshake line that the Tauri host parses.
"""

from __future__ import annotations

import logging
import sys


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(stream=sys.stderr)
    fmt = "[upiqlo-engine] %(asctime)s %(levelname)s %(name)s - %(message)s"
    handler.setFormatter(logging.Formatter(fmt))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
