// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;
mod commands;

use std::sync::Arc;
use tokio::sync::Mutex;

use engine::EngineHandle;
use tauri::{Manager, RunEvent, WindowEvent};

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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Kill the sidecar as soon as the main window is asked
                // to close. Windows would otherwise leave the
                // PyInstaller process running after the GUI disappears.
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    let engine = state.engine.clone();
                    tauri::async_runtime::spawn(async move {
                        engine.lock().await.kill();
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_engine_port,
            commands::get_engine_token,
            commands::ping,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Upiqal")
        .run(|app, event| {
            // Last-line defence: kill the sidecar on the global Exit
            // event (covers cmd+Q and other exit paths the window
            // handler doesn't see).
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    let engine = state.engine.clone();
                    tauri::async_runtime::block_on(async move {
                        engine.lock().await.kill();
                    });
                }
            }
        });
}
