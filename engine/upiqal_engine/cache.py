"""In-memory LRU cache for comparison results.

Keyed by a content-hash of (reference bytes, target bytes, params dict) so
that re-running the same pair with the same params is free. Backed by a
plain OrderedDict; the sidecar is single-process so no locking is needed
beyond Python's GIL.

The cache is also used to satisfy ``GET /api/report/:session_id/:pair_id``
for previously-computed pairs in folder-compare sessions.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Optional

from .pipeline import CompareResult

CACHE_CAPACITY = 32


class ResultCache:
    def __init__(self, capacity: int = CACHE_CAPACITY) -> None:
        self._capacity = capacity
        self._store: "OrderedDict[str, CompareResult]" = OrderedDict()
        self._lock = threading.Lock()
        # Session-scoped registry: session_id -> pair_id -> cache_key
        self._sessions: Dict[str, Dict[str, str]] = {}

    @staticmethod
    def key_for(reference_path: str, target_path: str, params: Dict[str, Any]) -> str:
        h = hashlib.sha256()
        for path in (reference_path, target_path):
            p = Path(path)
            st = p.stat()
            # mtime + size is sufficient for local-file inputs; hashing the
            # full bytes of 50-MB images on every lookup would be wasteful.
            h.update(str(p.resolve()).encode())
            h.update(str(st.st_mtime_ns).encode())
            h.update(str(st.st_size).encode())
        h.update(json.dumps(params, sort_keys=True).encode())
        return h.hexdigest()

    def get(self, key: str) -> Optional[CompareResult]:
        with self._lock:
            r = self._store.get(key)
            if r is not None:
                self._store.move_to_end(key)
            return r

    def put(self, key: str, value: CompareResult) -> None:
        with self._lock:
            self._store[key] = value
            self._store.move_to_end(key)
            while len(self._store) > self._capacity:
                self._store.popitem(last=False)

    def register_session(self, session_id: str, pair_id: str, key: str) -> None:
        with self._lock:
            self._sessions.setdefault(session_id, {})[pair_id] = key

    def get_by_session(self, session_id: str, pair_id: str) -> Optional[CompareResult]:
        with self._lock:
            key = self._sessions.get(session_id, {}).get(pair_id)
            if key is None:
                return None
            r = self._store.get(key)
            if r is not None:
                self._store.move_to_end(key)
            return r

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._sessions.clear()


cache = ResultCache()
