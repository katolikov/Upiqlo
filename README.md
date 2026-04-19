# Upiqal

A **native cross-platform desktop app** for interactive image quality comparison,
built on top of the [FR-IQA-Algo (UPIQAL)](../FR-IQA-Algo) full-reference image-
quality algorithm.

* **100 % offline** — model weights and the full Python engine are bundled inside
  the installer. No internet access, no Python install, no background web server
  visible to the user.
* **Browser-like tabs** — each image-pair comparison runs in its own isolated
  session. Single-image mode (A vs B) and folder-compare mode with Prev/Next
  navigation.
* **Beyond Compare-style workspace** — a 3-pane horizontal split (Reference /
  Output / Target) with synchronised zoom & pan and a middle-pane sub-tab row
  switching between the algorithm's seven diagnostic layers (Unified overlay,
  Overlay, Anomaly, Structure, Color, Ringing, Noise, Blur).
* **Live streaming + true cancellation** — stage-by-stage progress via SSE, and
  a Cancel button that SIGKILLs the inference subprocess to free CPU within
  ~1 second.

Supported targets: Windows x86_64, Linux x86_64 + aarch64, macOS aarch64.

![Architecture](docs/architecture.md)

## Architecture

```
 ┌────────────────────────────────────┐
 │  Native window (Tauri v2 shell)    │
 │  src-tauri/  ·  OS webview         │
 │  ─ spawns the engine sidecar ↓     │
 └──┬─────────────────────────────────┘
    │ stdout handshake:
    │   UPIQAL_ENGINE_PORT=<random>
    │   UPIQAL_ENGINE_TOKEN=<secret>
    ▼
 ┌────────────────────────────────────┐       ┌─────────────────────────────┐
 │  Python engine (PyInstaller)       │◄─────►│  React + Vite + Tailwind    │
 │  engine/  ·  loopback only         │ HTTP+ │  ui/  rendered in the       │
 │  FastAPI + bearer-token auth       │  SSE  │  Tauri native webview       │
 │  Per-request inference subprocess  │       │  Zustand store, streamed    │
 │  (SIGKILL-able true cancellation)  │       │  progress, 3-pane workspace │
 └────────────────────────────────────┘       └─────────────────────────────┘
```

* **Tauri v2** owns the native window and manages the sidecar process lifecycle.
  The webview renders the UI; nothing ever opens in the user's browser.
* **Python engine** runs a local FastAPI on `127.0.0.1:<random-port>`, guarded by
  a per-launch bearer token that only the Tauri host knows. On every comparison,
  the engine spawns a child process (`upiqal_engine.subworker`) so it can SIGKILL
  it for instant cancellation.
* **UI** is a Vite + React + TypeScript + Tailwind app. State lives in Zustand.
  Per-session parameter snapshots let each tab have its own `max_side`,
  `score_mode`, etc.

For deeper design notes see [`docs/architecture.md`](docs/architecture.md). For
a step-by-step install/dev/build walkthrough see [`HOWTO.md`](HOWTO.md).

## Quick start

```bash
# 1. Install JS deps (root + ui workspace)
npm install

# 2. Create the engine venv + install CPU torch + vendor the algorithm
./scripts/setup-engine.sh
# (expects FR-IQA-Algo to be a sibling directory: ../FR-IQA-Algo)

# 3. Run in dev mode — engine + Vite + Tauri window
./scripts/dev.sh
```

The Tauri window opens showing an `Engine 0.1.0 · ready` chip in the top-right.
Pick a reference + target image, click **Compare**, watch stages stream through
the progress bar, and read the score / dominant artifact / severity bars from
the bottom dashboard.

## Running pieces individually

| Command                               | What it does |
|---------------------------------------|--------------|
| `npm run dev:engine`                  | Just the Python FastAPI engine (port 51017). |
| `npm run dev:ui`                      | Just the Vite dev server at http://127.0.0.1:5173/. |
| `npm run tauri:dev`                   | Tauri host + its `beforeDevCommand` runs Vite. |
| `cd engine && .venv/bin/python -m pytest tests -q` | Engine test suite (26 tests, real algo). |
| `python engine/scripts/build_sidecar.py` | Build the PyInstaller sidecar for the host triple. |
| `npx @tauri-apps/cli@2 build --target <rust-triple>` | Build the native installer. |

## Release builds

```bash
# 1. Build the Python sidecar for the current host
python engine/scripts/build_sidecar.py
# → engine/dist/upiqal-engine-<triple>/   (~928 MB one-dir bundle)

# 2. Stage it into src-tauri/binaries/ so Tauri's resource glob picks it up
mkdir -p src-tauri/binaries
cp -R engine/dist/upiqal-engine-<triple> src-tauri/binaries/

# 3. Build the installer
npx @tauri-apps/cli@2 build --target <triple>
# macOS  → src-tauri/target/<triple>/release/bundle/macos/Upiqal.app  (+ .dmg)
# Linux  → src-tauri/target/<triple>/release/bundle/{deb,appimage}/
# Windows→ src-tauri/target/<triple>/release/bundle/{msi,nsis}/
```

Running `Upiqal.app` (or the equivalent installer output) from a sanitized
`env -i PATH=/usr/bin:/bin` shell proves the bundle needs no Python, pip,
uv, or network access — the engine sidecar loads VGG16 from its own
`_internal/weights/` and serves `/healthz` returning
`{"algorithm_available": true}`.

## CI

`.github/workflows/build.yml` runs a four-target matrix:

| Target              | Runner           | Outputs                      |
|---------------------|------------------|------------------------------|
| `windows-x86_64`    | `windows-latest` | `.msi`, `.exe`               |
| `linux-x86_64`      | `ubuntu-latest`  | `.AppImage`, `.deb`          |
| `linux-aarch64`     | `ubuntu-24.04-arm` | `.AppImage`, `.deb`        |
| `macos-aarch64`     | `macos-14`       | `.app`, `.dmg`               |

Each job runs engine pytest, builds + smoke-tests the PyInstaller sidecar,
stages it into `src-tauri/binaries/`, and runs `cargo tauri build`. Enable by
uncommenting the `push` / `pull_request` triggers in the workflow YAML.

## Installing a downloaded release

### macOS

The `.dmg` / `.app` assets published on the GitHub Releases page are **not
code-signed or notarized** (no Apple Developer ID is wired into CI yet).
Gatekeeper on Apple Silicon will refuse to launch a freshly-downloaded
Upiqal with a popup that says *"Upiqal is damaged and can't be opened."*
The app is not actually damaged — macOS just quarantined it because it
wasn't signed.

Drag `Upiqal.app` to `/Applications`, then strip the quarantine flag once:

```bash
xattr -cr /Applications/Upiqal.app
```

After that the app launches normally on every future run. The same applies
if you extract the `.app` directly from the `.dmg` by drag-and-drop — `xattr
-cr` on the destination folder clears it. Once the project ships signed +
notarized builds, this step will no longer be needed.

### Windows / Linux

No extra steps beyond running the installer (`.msi` / `.exe`, `.deb` /
`.AppImage`). SmartScreen on Windows may show an "Unrecognised publisher"
dialog for unsigned builds; click *More info → Run anyway*.

## Project layout

```
ui/            React + Vite + TypeScript + Tailwind frontend
src-tauri/     Rust Tauri host (sidecar lifecycle, IPC commands, auth handshake)
engine/        Python FastAPI sidecar (PyInstaller-built for distribution)
  vendor/      (gitignored) algorithm + weights copied from ../FR-IQA-Algo
  scripts/     vendor_algorithm.py, build_sidecar.py
  tests/       26 real-algorithm tests (auth, folders, pipeline, server,
               streaming w/ cancel, integration)
docs/          Architecture + build docs
scripts/       dev.sh, setup-engine.sh, clean.sh (all token-aware)
.github/       workflows/build.yml (4-target matrix, local by default)
```

## License

All rights reserved. License terms TBD.
