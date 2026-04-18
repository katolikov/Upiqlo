# Tauri app icons

Generate with:

```bash
cargo tauri icon ../docs/branding/upiqlo-icon-1024.png
```

Phase 1 ships without real icons. Tauri falls back to defaults during
`cargo tauri dev` if this directory is empty; `cargo tauri build` requires
at minimum `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, and
`icon.ico`.
