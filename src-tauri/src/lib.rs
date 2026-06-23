mod commands;
mod plugin_host;
pub mod providers;
mod secrets;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::create(app)?;
            let _ = plugin_host::run_demo_provider(&plugin_host::InfUsageHost);
            let _ = plugin_host::run_deepseek_provider(&plugin_host::InfUsageHost);
            let _ = plugin_host::run_codex_provider(&plugin_host::InfUsageHost);
            let _ = plugin_host::run_claude_provider(&plugin_host::InfUsageHost);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::refresh_claude,
            commands::refresh_codex,
            commands::save_deepseek_api_key,
            commands::list_deepseek_api_keys,
            commands::delete_deepseek_api_key,
            commands::refresh_deepseek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
