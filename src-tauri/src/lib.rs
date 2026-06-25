mod commands;
mod plugin_host;
pub mod providers;
mod secrets;
mod snapshot_store;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::create(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_saved_snapshots,
            commands::hide_tray_window,
            commands::request_tray_close,
            commands::set_tray_popped_out,
            commands::set_tray_display_mode,
            commands::refresh_claude,
            commands::refresh_codex,
            commands::save_deepseek_api_key,
            commands::list_deepseek_api_keys,
            commands::delete_deepseek_api_key,
            commands::refresh_deepseek,
            commands::opencode_quota_session_status,
            commands::save_opencode_quota_session,
            commands::disconnect_opencode_quota,
            commands::refresh_opencode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
