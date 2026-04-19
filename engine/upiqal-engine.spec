# PyInstaller spec for the Upiqal engine sidecar.
#
# Produces a one-dir build at `dist/upiqal-engine/`. The outer
# `scripts/build_sidecar.py` renames that to `upiqal-engine-<target-triple>`
# so Tauri's `externalBin` picks it up on every platform.
#
# NOTE: run from the `engine/` directory so relative paths resolve.

# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

hiddenimports = []
hiddenimports += collect_submodules("torch")
hiddenimports += collect_submodules("torchvision")
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("uvicorn.lifespan")
hiddenimports += collect_submodules("uvicorn.loops")
hiddenimports += collect_submodules("uvicorn.protocols")
hiddenimports += collect_submodules("upiqal")

datas = []
# Algorithm package (vendored) + model weights + upstream CLI module.
datas += [("vendor/upiqal", "upiqal")]
datas += [("vendor/weights", "weights")]
# upiqal_cli.py is a top-level module (not a package) imported by
# pipeline._call_run_pipeline → run_pipeline. Keep it next to the
# upiqal/ package so one sys.path entry covers both.
datas += [("vendor/upiqal_cli.py", ".")]
# Torch runtime data (cuBLAS shims, etc. — even CPU wheels ship some).
datas += collect_data_files("torch")
datas += collect_data_files("torchvision")


a = Analysis(
    ["upiqal_engine/__main__.py"],
    pathex=["vendor"],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "notebook"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="upiqal-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="upiqal-engine",
)
