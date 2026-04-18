use tauri::State;

use crate::{engine, AppState};

/// Return the port the Python engine is serving on.
///
/// Errors until the engine has printed its handshake line.
#[tauri::command]
pub async fn get_engine_port(state: State<'_, AppState>) -> Result<u16, String> {
    engine::current_port(state.inner())
        .await
        .map_err(|e| e.to_string())
}

/// Return the bearer token the engine requires on every /api/* request.
#[tauri::command]
pub async fn get_engine_token(state: State<'_, AppState>) -> Result<String, String> {
    engine::current_token(state.inner())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
