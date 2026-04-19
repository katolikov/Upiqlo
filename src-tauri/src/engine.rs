//! Manage the lifecycle of the Upiqal Python engine sidecar.
//!
//! The sidecar is a PyInstaller-built binary (`upiqal-engine-<triple>`) that
//! prints a two-line handshake on stdout:
//!
//!     UPIQAL_ENGINE_PORT=<port>\n
//!     UPIQAL_ENGINE_TOKEN=<token>\n
//!
//! We parse both and stash them in `EngineHandle`. The frontend retrieves
//! them via the `get_engine_port` / `get_engine_token` Tauri commands and
//! must attach the token as `Authorization: Bearer <token>` on every API
//! request. This turns the loopback HTTP bridge into a strictly internal
//! hidden channel that even other local processes cannot drive.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::AppState;

/// Rust target triple at build time (lowercased host triple).
const TARGET_TRIPLE: &str = env!("TARGET_TRIPLE");

#[derive(Default)]
pub struct EngineHandle {
    pub port: Option<u16>,
    pub token: Option<String>,
    /// Retained so we can explicitly `kill()` the sidecar when the
    /// Tauri window closes. Without this, `CommandChild` drops as a
    /// no-op on Windows and leaves a zombie `upiqal-engine` process.
    pub child: Option<tauri_plugin_shell::process::CommandChild>,
}

impl EngineHandle {
    pub fn new() -> Self {
        Self::default()
    }

    /// Best-effort kill of the sidecar. Called on window close / app
    /// exit so ML processes don't linger past the GUI.
    pub fn kill(&mut self) {
        if let Some(child) = self.child.take() {
            match child.kill() {
                Ok(_) => log::info!("Engine sidecar terminated cleanly"),
                Err(err) => log::warn!("Engine sidecar kill failed: {err}"),
            }
        }
    }
}

pub async fn spawn_engine(app: &AppHandle) -> Result<()> {
    let exe = resolve_sidecar_executable(app)?;
    log_diag(app, &format!("Spawning Upiqal engine sidecar: {}", exe.display()));
    log::info!("Spawning Upiqal engine sidecar: {}", exe.display());

    // Use the shell plugin's `command()` (platform-agnostic launcher) so the
    // same stdout/stderr stream plumbing works as with a named sidecar.
    //
    // Environment hardening:
    //   * PYTHONUNBUFFERED=1 — force line-buffered stdout for the frozen
    //     Python child. Without this, the handshake lines sit in Python's
    //     stdout buffer on Windows (pipes are block-buffered) and never
    //     reach this process, so the UI sees an "engine offline" chip
    //     forever even though the child is healthy.
    //   * PYTHONIOENCODING=utf-8 — avoid Windows "charmap" codec errors
    //     when the frozen child logs non-ASCII file paths.
    let cmd = app
        .shell()
        .command(exe.to_string_lossy().to_string())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");
    let (mut rx, child) = cmd.spawn().context("spawning upiqal-engine sidecar")?;

    // Stash the child handle so we can kill it on window close.
    if let Some(state) = app.try_state::<AppState>() {
        let mut guard = state.engine.lock().await;
        guard.child = Some(child);
    }

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut port_captured = false;
        let mut token_captured = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let trimmed = line.trim_end();
                    log_diag(&handle, &format!("[engine:out] {trimmed}"));
                    if !port_captured {
                        if let Some(port) = parse_port_line(trimmed) {
                            log::info!("Engine online on port {port}");
                            log_diag(&handle, &format!("Engine online on port {port}"));
                            if let Some(state) = handle.try_state::<AppState>() {
                                let mut guard = state.engine.lock().await;
                                guard.port = Some(port);
                            }
                            port_captured = true;
                            continue;
                        }
                    }
                    if !token_captured {
                        if let Some(token) = parse_token_line(trimmed) {
                            log::info!("Engine auth token captured");
                            log_diag(&handle, "Engine auth token captured");
                            if let Some(state) = handle.try_state::<AppState>() {
                                let mut guard = state.engine.lock().await;
                                guard.token = Some(token);
                            }
                            token_captured = true;
                            continue;
                        }
                    }
                    log::info!("[engine] {trimmed}");
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let trimmed = line.trim_end();
                    log::info!("[engine:err] {trimmed}");
                    log_diag(&handle, &format!("[engine:err] {trimmed}"));
                }
                CommandEvent::Error(err) => {
                    log::error!("[engine] error: {err}");
                    log_diag(&handle, &format!("[engine] error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[engine] terminated: code={:?}, signal={:?}", payload.code, payload.signal);
                    log_diag(
                        &handle,
                        &format!(
                            "[engine] terminated: code={:?}, signal={:?}",
                            payload.code, payload.signal
                        ),
                    );
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Append a timestamped line to `<local-app-data>/Upiqal/engine.log`.
///
/// The Windows release build uses `windows_subsystem = "windows"` which
/// detaches stderr, so `env_logger` output vanishes. This file log gives
/// us a deterministic place to read spawn + handshake diagnostics from on
/// end-user machines without rebuilding. On macOS/Linux it's additive —
/// stderr still carries the same messages.
fn log_diag(app: &AppHandle, msg: &str) {
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let Ok(dir) = app.path().app_local_data_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("engine.log");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{ts} {msg}");
    }
}

/// Find the sidecar executable inside the bundle's resource directory.
///
/// Resources land in platform-specific locations:
///   * macOS: <app>.app/Contents/Resources/
///   * Windows/Linux: next to the executable, under resources/
/// Tauri's `path_resolver().resolve_resource(...)` abstracts that away.
fn resolve_sidecar_executable(app: &AppHandle) -> Result<PathBuf> {
    let folder_name = format!("upiqal-engine-{TARGET_TRIPLE}");
    let bin_name = if cfg!(target_os = "windows") {
        "upiqal-engine.exe"
    } else {
        "upiqal-engine"
    };
    let relative = format!("binaries/{folder_name}/{bin_name}");

    // Preferred: the bundled resource path at runtime.
    if let Ok(p) = app.path().resolve(&relative, tauri::path::BaseDirectory::Resource) {
        if p.is_file() {
            return Ok(p);
        }
    }

    // Dev fallback: src-tauri/binaries/ next to the project during `cargo
    // tauri dev` when resources aren't staged into a bundle yet.
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if dev.is_file() {
        return Ok(dev);
    }

    Err(anyhow!(
        "upiqal-engine sidecar not found. Expected at Resource/{relative} \
         (production) or {} (dev). Run `python engine/scripts/build_sidecar.py` \
         and stage into src-tauri/binaries/.",
        dev.display()
    ))
}

fn parse_port_line(line: &str) -> Option<u16> {
    const PREFIX: &str = "UPIQAL_ENGINE_PORT=";
    line.strip_prefix(PREFIX).and_then(|s| s.parse::<u16>().ok())
}

fn parse_token_line(line: &str) -> Option<String> {
    const PREFIX: &str = "UPIQAL_ENGINE_TOKEN=";
    line.strip_prefix(PREFIX)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub async fn current_port(state: &AppState) -> Result<u16> {
    let guard = state.engine.lock().await;
    guard
        .port
        .ok_or_else(|| anyhow!("engine has not announced a port yet"))
}

pub async fn current_token(state: &AppState) -> Result<String> {
    let guard = state.engine.lock().await;
    guard
        .token
        .clone()
        .ok_or_else(|| anyhow!("engine has not announced a token yet"))
}

#[cfg(test)]
mod tests {
    use super::{parse_port_line, parse_token_line};

    #[test]
    fn parses_valid_port() {
        assert_eq!(parse_port_line("UPIQAL_ENGINE_PORT=51017"), Some(51017));
    }

    #[test]
    fn rejects_port_garbage() {
        assert_eq!(parse_port_line("hello world"), None);
        assert_eq!(parse_port_line("UPIQAL_ENGINE_PORT="), None);
        assert_eq!(parse_port_line("UPIQAL_ENGINE_PORT=not-a-number"), None);
    }

    #[test]
    fn parses_valid_token() {
        assert_eq!(
            parse_token_line("UPIQAL_ENGINE_TOKEN=abc123_xyz"),
            Some("abc123_xyz".to_string())
        );
    }

    #[test]
    fn rejects_token_garbage() {
        assert_eq!(parse_token_line("UPIQAL_ENGINE_TOKEN="), None);
        assert_eq!(parse_token_line("unrelated"), None);
    }
}
