# Upiqal Architecture

See [../README.md](../README.md) for the overview and the approved plan at
`/Users/artemkatolikov/.claude/plans/atomic-fluttering-manatee.md` for the
full design rationale.

## Process model

- **Desktop host** (Rust, `src-tauri/`) — owns the window, spawns the sidecar,
  exposes `get_engine_port` via Tauri IPC.
- **Engine sidecar** (Python, `engine/`) — FastAPI on loopback. One instance
  per app launch; killed on window close.
- **UI** (TypeScript, `ui/`) — served by Vite in dev, bundled into the Tauri
  webview in release.

## Engine handshake

The sidecar prints exactly one line before serving:

```
UPIQAL_ENGINE_PORT=51017
```

The Rust host reads this on stdout, stores the port in `AppState::engine`,
and thereafter lets the frontend query it via `invoke("get_engine_port")`.
All later output is routed to the Rust log (stderr-prefixed with
`[engine]`).

## Why not HTTP-discovery via a well-known port?

- Multiple Upiqal windows would collide.
- Antivirus sometimes blocks fixed high ports on Windows.
- `socket(0)` lets the OS pick a known-free port deterministically.

## Session model

Sessions are a **frontend concern**: each tab in the UI holds its own
reference/target paths, parameter overrides, and cached response. The
engine is stateless except for an LRU cache of the last ~32 results keyed
by `(hash(ref), hash(tgt), params)`. This cache lives in process memory
and disappears when the app exits.

## Packaging

Release builds use PyInstaller's **one-dir** mode (not one-file) to avoid
torch's extract-on-every-launch penalty. Tauri's `externalBin` convention
requires the sidecar binary to be named
`upiqal-engine-<rust-target-triple>(.exe)`, so
`engine/scripts/build_sidecar.py` renames the PyInstaller output folder
accordingly.
