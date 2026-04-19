# Upiqal — How To

Step-by-step recipes for the common workflows: first-time setup, the inner
development loop, running tests, building release installers, and shipping.

## 1. First-time setup

### 1.1 Tooling (once per machine)

| Tool        | Version   | Install                                       |
|-------------|-----------|-----------------------------------------------|
| Node.js     | 20+       | https://nodejs.org  (22 recommended)          |
| Rust        | 1.77+     | `curl https://sh.rustup.rs -sSf \| sh`        |
| uv          | 0.5+      | https://docs.astral.sh/uv/                    |

The Tauri CLI is installed automatically via `devDependencies` in the root
`package.json` — no global Cargo install required.

### 1.2 Clone + sibling checkout

Upiqal expects the algorithm repo to live in a sibling directory:

```bash
cd ~/DEV
git clone git@github.com:<owner>/Upiqal.git
git clone git@github.com:<owner>/FR-IQA-Algo.git
ls
#  FR-IQA-Algo/   ← algorithm (imported + vendored)
#  Upiqal/        ← this repo
```

### 1.3 Install JS + Python deps

```bash
cd Upiqal
npm install                          # root + ui workspace (Tauri CLI too)
./scripts/setup-engine.sh            # engine venv w/ Python 3.11 + CPU torch
```

`setup-engine.sh` creates `engine/.venv/` with `uv`, installs CPU-only torch
wheels from the PyTorch CPU index, and runs `vendor_algorithm.py` to copy the
latest `upiqal/`, `weights/`, and `upiqal_cli.py` from `../FR-IQA-Algo`
into `engine/vendor/`.

### 1.4 Smoke test

```bash
cd engine && .venv/bin/python -m pytest tests -q
# Expect: 26 passed in ~60s
```

## 2. Development loop

### 2.1 One-shot: engine + UI + Tauri

```bash
./scripts/dev.sh
```

This generates a fresh per-session bearer token, exports it to both sides,
launches the engine on `127.0.0.1:51017`, and runs `cargo tauri dev` which
spawns Vite and then the Tauri window.

### 2.2 Iterating on the UI in a browser (no Tauri)

Useful for quick React edits with hot-reload:

```bash
# Terminal 1
./scripts/dev-engine.sh              # prints both the PORT and TOKEN

# Terminal 2
VITE_UPIQAL_ENGINE_PORT=51017 \
VITE_UPIQAL_ENGINE_TOKEN="<token from terminal 1>" \
npm --prefix ui run dev
# → http://127.0.0.1:5173/
```

The engine's `/api/file` passthrough endpoint lets the browser preview
reference/target images without Tauri's `convertFileSrc`. In production
(Tauri) this fallback is unused.

### 2.3 Iterating on the engine

```bash
cd engine
.venv/bin/python -m pytest tests -q           # fast full suite
.venv/bin/python -m pytest tests/test_streaming.py::test_cancel_kills_subprocess_within_2s -v
```

Changes to `upiqal_engine/*.py` are picked up on the next engine restart. The
upstream algorithm is imported via `sys.path.insert(0, "vendor")` — if you
change `../FR-IQA-Algo/upiqal/*.py`, re-run `engine/scripts/vendor_algorithm.py`.

### 2.4 Iterating on the Rust host

```bash
cd src-tauri
cargo check             # 5-10 s — catches compile errors fast
cargo test              # Rust unit tests (handshake parsers)
```

## 3. Testing

### 3.1 Full engine suite

```bash
cd engine && .venv/bin/python -m pytest tests -q
```

Covers:

* `test_auth.py` — bearer-token auth accept/reject/query fallback.
* `test_folders.py` — filename + index pairing, hidden-file skip.
* `test_pipeline.py` — real algorithm end-to-end on `left.png` / `right.png`
  plus self-comparison regression (score ≥ 0.90).
* `test_server.py` — `/api/compare*`, cache hits, folder endpoints.
* `test_streaming.py` — SSE stages, true cancellation ≤ 2.5 s,
  concurrent streams, cache shortcut.
* `test_integration.py` — UI-code-path replica: token-authed SSE stream →
  real algorithm → Base64 heatmaps → PIL decode.

### 3.2 Rust tests

```bash
cd src-tauri && cargo test
```

## 4. Release builds

### 4.1 Build the Python sidecar

```bash
cd engine
.venv/bin/python scripts/build_sidecar.py
# → dist/upiqal-engine-<rust-target-triple>/
```

The output is a PyInstaller **one-dir** bundle (~928 MB on macOS aarch64):
* `<bundle>/upiqal-engine` (entry point — also dispatches the `__subworker__`
  re-exec).
* `<bundle>/_internal/` with `upiqal/`, `upiqal_cli.py`, `weights/`, and the
  torch runtime DLLs.

You can smoke-test the sidecar directly (no Tauri required):

```bash
env -i PATH=/usr/bin:/bin HOME="$HOME" \
  UPIQAL_ENGINE_PORT_OVERRIDE=51200 \
  UPIQAL_ENGINE_TOKEN_OVERRIDE="smoke-token" \
  engine/dist/upiqal-engine-<triple>/upiqal-engine &

curl http://127.0.0.1:51200/healthz
# → {"status":"ok","version":"0.1.0","algorithm_available":true}
```

### 4.2 Stage into src-tauri and bundle the installer

```bash
mkdir -p src-tauri/binaries
cp -R engine/dist/upiqal-engine-<triple> src-tauri/binaries/

npx @tauri-apps/cli@2 build --target <triple>
```

Artifacts land under `src-tauri/target/<triple>/release/bundle/`:

| Platform     | Files                                              |
|--------------|----------------------------------------------------|
| macOS aarch64| `macos/Upiqal.app` + `dmg/Upiqal_*.dmg`            |
| Windows x64  | `msi/Upiqal_*.msi` + `nsis/Upiqal_*-setup.exe`     |
| Linux x64/arm| `deb/upiqal_*.deb` + `appimage/Upiqal_*.AppImage`  |

### 4.3 Verify the installer is truly self-contained

```bash
# macOS:
env -i PATH=/usr/bin:/bin HOME="$HOME" \
  src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Upiqal.app/Contents/MacOS/upiqal &

sleep 10
lsof -iTCP -sTCP:LISTEN -a -c upiqal-engine
# → upiqal-engine  <pid>  ...  TCP localhost:<port> (LISTEN)

curl http://127.0.0.1:<port>/healthz
# → {"status":"ok","version":"0.1.0","algorithm_available":true}
```

This must succeed with **no Python, no uv, no pip, no network** available on
the environment — proving the bundle ships everything.

## 5. CI matrix builds

The same build steps run in CI via `.github/workflows/build.yml`:

```bash
# Run locally (requires gh CLI)
gh workflow run build.yml

# Or enable on push:
#   Edit .github/workflows/build.yml and uncomment the `on: push:` trigger.
```

The workflow produces artifacts per target:

* `upiqal-windows-x86_64` — Windows installers.
* `upiqal-linux-x86_64` / `upiqal-linux-aarch64` — Linux installers.
* `upiqal-macos-aarch64` — macOS `.app` + `.dmg`.

## 6. Troubleshooting

| Symptom                                       | Likely cause                                                         | Fix |
|-----------------------------------------------|----------------------------------------------------------------------|-----|
| TopBar chip: "Engine offline"                 | Engine binary missing or wrong port                                  | Check `engine/dist/`, rerun `build_sidecar.py`, check `UPIQAL_ENGINE_PORT_OVERRIDE`. |
| `/api/compare-paths` returns `401`            | Missing or wrong bearer token                                        | UI: ensure `VITE_UPIQAL_ENGINE_TOKEN` matches engine's token. curl: `-H "Authorization: Bearer <token>"`. |
| "upiqal_cli.py not found"                     | `engine/vendor/` is stale after upstream changes                     | Rerun `engine/scripts/vendor_algorithm.py`. |
| PyInstaller `ImportError: attempted relative import` | `upiqal_engine/__main__.py` used relative imports               | Already fixed — absolute imports only. |
| Tauri build fails with "failed to open icon"  | `src-tauri/icons/` missing                                           | Icons are generated during setup; regenerate via `cargo tauri icon docs/branding/upiqal-icon-1024.png` (or use the scripted PIL generator in commit history). |
| DMG creation fails on macOS (hdiutil)         | No developer signing identity; not blocking                          | The `.app` itself is complete at `bundle/macos/Upiqal.app`. For distribution, codesign + notarize separately. |

## 7. Architecture cheatsheet

* **UI never blocks**: every long-running call streams via SSE over `fetch`;
  the React state is updated per stage event.
* **True cancellation**: each streamed run is a child `python -m
  upiqal_engine.subworker` (or the PyInstaller bundle's `__subworker__`
  re-exec). `DELETE /api/compare/:token` calls `process.kill()` → SIGKILL →
  torch tensors and allocator arenas are reclaimed by the kernel within
  ≲ 1 s. No cooperation with C++ torch internals required.
* **Per-session parameters**: the TopBar writes to the active tab's snapshot,
  not to globals. New tabs snapshot current globals at `openSession`.
* **Bearer token handshake**: engine prints `UPIQAL_ENGINE_TOKEN=<token>`
  after `UPIQAL_ENGINE_PORT`; Tauri's Rust host parses both and exposes
  `get_engine_port` / `get_engine_token` as Tauri commands.
* **Offline-safe**: no Google Fonts, no CDN, no pip-install-at-runtime, no
  telemetry. The installer contains everything the engine needs.
