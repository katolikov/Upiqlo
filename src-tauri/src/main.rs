// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;

use engine::EngineHandle;

pub struct AppState {
    pub engine: Arc<Mutex<EngineHandle>>,
}

fn main() {
    env_logger::init();

    let engine_handle = EngineHandle::new();
    let state = AppState {
        engine: Arc::new(Mutex::new(engine_handle)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = engine::spawn_engine(&handle).await {
                    log::error!("Failed to start engine sidecar: {err:#}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_engine_port,
            commands::get_engine_token,
            commands::ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Upiqlo");
}
