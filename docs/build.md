# Upiqlo build notes

## Targets

| OS       | Arch    | Rust triple                    | Runner (GH Actions)   |
|----------|---------|--------------------------------|-----------------------|
| Windows  | x86_64  | `x86_64-pc-windows-msvc`       | `windows-latest`      |
| Linux    | x86_64  | `x86_64-unknown-linux-gnu`     | `ubuntu-latest`       |
| Linux    | aarch64 | `aarch64-unknown-linux-gnu`    | `ubuntu-24.04-arm`    |
| macOS    | aarch64 | `aarch64-apple-darwin`         | `macos-14`            |

## Per-job steps

1. Install Python 3.11 + `uv`.
2. Bootstrap the engine venv with CPU torch wheels.
3. Run `python engine/scripts/vendor_algorithm.py` (copies `upiqal/` + `weights/`
   from a checkout of `FR-IQA-Algo` done in a previous matrix step).
4. Run `python engine/scripts/build_sidecar.py --target <triple>` which:
   - invokes PyInstaller on `upiqlo-engine.spec`
   - renames `dist/upiqlo-engine/` → `dist/upiqlo-engine-<triple>/`
5. Copy `engine/dist/upiqlo-engine-<triple>` into `src-tauri/binaries/`.
6. `npm ci` at the root.
7. `cargo tauri build`.
8. Upload the resulting `.exe`, `.msi`, `.dmg`, `.AppImage`, `.deb` to artifacts.

## PyInstaller gotchas

- `torch` hidden imports: collect via `collect_submodules("torch")`.
- `uvicorn` needs `uvicorn.lifespan.on`, `uvicorn.loops.*`, `uvicorn.protocols.*`
  which the spec pulls via `collect_submodules("uvicorn")`.
- Weights are included as `datas`; they live under `sys._MEIPASS/weights/` at
  runtime. `engine/upiqlo_engine/server.py` will resolve them via
  `Path(sys._MEIPASS) / "weights"` in Phase 2.
- CPU torch wheels for Linux aarch64 are only published for recent releases.
  We pin `torch<2.5` to avoid drifting past supported wheel matrices.

## Signing / notarisation

Out of scope for Phase 1. macOS codesigning requires a Developer ID, and
Windows code-signing requires a cert — both added in Phase 5 if needed.
