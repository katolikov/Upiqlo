"""Entry point for the Upiqal engine sidecar.

Behaviour
---------
1. Binds a free TCP port on 127.0.0.1.
2. Generates a random bearer token (or uses UPIQAL_ENGINE_TOKEN_OVERRIDE
   if set, so dev.sh can share the token with Vite).
3. Prints exactly two handshake lines on stdout:

       UPIQAL_ENGINE_PORT=<port>\n
       UPIQAL_ENGINE_TOKEN=<token>\n

   The Tauri host reads these, stores the values in its state, and
   exposes them to the frontend via ``get_engine_port`` /
   ``get_engine_token`` commands. The token must accompany every
   non-health request as ``Authorization: Bearer <token>``.

Subworker re-exec
-----------------
Inside a PyInstaller bundle, ``sys.executable`` is the bundle binary and
``python -m foo`` is not a valid invocation. The parent spawns its
subworker by re-executing the bundle with the argv sentinel
``__subworker__`` as the first argument; this module recognises that
sentinel and dispatches to :func:`upiqal_engine.subworker.main` instead
of starting the FastAPI server.

All other engine output (uvicorn logs, algorithm progress, …) is routed
to stderr so the handshake protocol on stdout stays clean.
"""

from __future__ import annotations

import logging
import os
import secrets
import socket
import sys

import uvicorn

# Absolute imports (not relative) so the module works both as
#   ``python -m upiqal_engine`` (dev, parent package is "upiqal_engine")
# and as
#   the PyInstaller bundle's __main__ (no parent package).
from upiqal_engine.logging_conf import configure_logging

SUBWORKER_SENTINEL = "__subworker__"


def _pick_free_port() -> int:
    """Ask the kernel for a free TCP port on 127.0.0.1."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _resolve_token() -> str:
    env = os.environ.get("UPIQAL_ENGINE_TOKEN_OVERRIDE")
    if env:
        return env
    return secrets.token_urlsafe(32)


def main() -> None:
    # Subworker dispatch — must happen before we touch logging/stdout,
    # because the subworker owns its own stdout handshake with the parent.
    if len(sys.argv) > 1 and sys.argv[1] == SUBWORKER_SENTINEL:
        # Rewrite argv so argparse in subworker.main() sees its expected flags.
        sys.argv = [sys.argv[0]] + sys.argv[2:]
        from upiqal_engine.subworker import main as subworker_main

        subworker_main()
        return

    configure_logging()
    log = logging.getLogger("upiqal_engine")

    env_port = os.environ.get("UPIQAL_ENGINE_PORT_OVERRIDE")
    port = int(env_port) if env_port else _pick_free_port()
    token = _resolve_token()

    # Publish the token to the server process via env so the FastAPI app
    # can read it at request-handling time.
    os.environ["UPIQAL_ENGINE_TOKEN"] = token

    sys.stdout.write(f"UPIQAL_ENGINE_PORT={port}\n")
    sys.stdout.write(f"UPIQAL_ENGINE_TOKEN={token}\n")
    sys.stdout.flush()

    log.info("Starting Upiqal engine on 127.0.0.1:%s", port)

    # Pass the app object (not an import string) so uvicorn doesn't need
    # to resolve "upiqal_engine.server" through its own import machinery —
    # that fails inside the PyInstaller bundle.
    from upiqal_engine.server import app

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_config=None,
        access_log=False,
        workers=1,
    )


if __name__ == "__main__":
    main()
