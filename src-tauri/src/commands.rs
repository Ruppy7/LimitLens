use crate::{
    plugin_host,
    providers::{claude, codex, deepseek, opencode_quota},
    secrets,
    snapshot_store::{self, SavedSnapshot},
    tray,
};

const OPENCODE_WORKSPACE_MARKER: &str = "/workspace/";

struct OpenCodeHost {
    usage_json: String,
}

impl plugin_host::Host for OpenCodeHost {
    fn app_name(&self) -> &'static str {
        "LimitLens"
    }

    fn opencode_usage_json(&self) -> String {
        self.usage_json.clone()
    }
}

struct DeepSeekHost {
    balance_json: String,
}

impl plugin_host::Host for DeepSeekHost {
    fn app_name(&self) -> &'static str {
        "LimitLens"
    }

    fn deepseek_balance_json(&self) -> String {
        self.balance_json.clone()
    }
}

struct CodexHost {
    usage_json: String,
}

impl plugin_host::Host for CodexHost {
    fn app_name(&self) -> &'static str {
        "LimitLens"
    }

    fn codex_usage_json(&self) -> String {
        self.usage_json.clone()
    }
}

struct ClaudeHost {
    usage_json: String,
}

impl plugin_host::Host for ClaudeHost {
    fn app_name(&self) -> &'static str {
        "LimitLens"
    }

    fn claude_usage_json(&self) -> String {
        self.usage_json.clone()
    }
}

#[tauri::command]
pub fn save_deepseek_api_key(api_key: String) -> Result<Vec<secrets::DeepSeekKeySlot>, String> {
    let trimmed = api_key.trim();

    if trimmed.is_empty() {
        return Err("DeepSeek API key must not be empty".to_string());
    }

    if secrets::load_deepseek_api_keys().len() >= secrets::MAX_DEEPSEEK_KEYS as usize {
        return Err("Delete the saved DeepSeek key before adding a new one".to_string());
    }

    secrets::save_deepseek_api_key(trimmed).map_err(|error| error.to_string())?;
    Ok(secrets::list_deepseek_key_slots())
}

#[tauri::command]
pub fn list_deepseek_api_keys() -> Vec<secrets::DeepSeekKeySlot> {
    secrets::list_deepseek_key_slots()
}

#[tauri::command]
pub fn delete_deepseek_api_key(slot: u8) -> Result<Vec<secrets::DeepSeekKeySlot>, String> {
    if !(1..=secrets::MAX_DEEPSEEK_KEYS).contains(&slot) {
        return Err("Unknown DeepSeek key slot".to_string());
    }

    secrets::delete_deepseek_api_key(slot).map_err(|error| error.to_string())?;
    Ok(secrets::list_deepseek_key_slots())
}

#[tauri::command]
pub async fn refresh_deepseek(
    app: tauri::AppHandle,
) -> Result<plugin_host::ProviderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let api_keys = secrets::load_deepseek_api_keys();

        if api_keys.is_empty() {
            return Err("DeepSeek API key is not saved".to_string());
        }

        let mut usd_remaining = 0.0;

        for (_slot, api_key) in api_keys {
            let balance_json = deepseek::fetch_balance_json(&api_key)
                .map_err(|error| provider_error("DeepSeek", &error))?;
            let balance = deepseek::parse_balance_json(&balance_json)
                .map_err(|error| provider_error("DeepSeek", &error))?;

            usd_remaining += deepseek::usd_total_balance(&balance);
        }

        let balance_json = deepseek::usd_balance_json(usd_remaining)
            .map_err(|error| provider_error("DeepSeek", &error))?;

        let snapshot = plugin_host::run_deepseek_provider(&DeepSeekHost { balance_json })
            .map_err(|error| internal_error("DeepSeek", &error))?;
        let _ = snapshot_store::save_latest(&app, &snapshot);
        Ok(snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn refresh_codex(app: tauri::AppHandle) -> Result<plugin_host::ProviderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let usage_json =
            codex::fetch_usage_summary_json().map_err(|error| provider_error("Codex", &error))?;

        let snapshot = plugin_host::run_codex_provider(&CodexHost { usage_json })
            .map_err(|error| internal_error("Codex", &error))?;
        let _ = snapshot_store::save_latest(&app, &snapshot);
        Ok(snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn refresh_claude(
    app: tauri::AppHandle,
) -> Result<plugin_host::ProviderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cached_plan = cached_provider_plan(&app, "claude");
        let usage_json = claude::fetch_usage_summary_json(cached_plan)
            .map_err(|error| provider_error("Claude", &error))?;

        let snapshot = plugin_host::run_claude_provider(&ClaudeHost { usage_json })
            .map_err(|error| internal_error("Claude", &error))?;
        let _ = snapshot_store::save_latest(&app, &snapshot);
        Ok(snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn cached_provider_plan(app: &tauri::AppHandle, provider_id: &str) -> Option<String> {
    snapshot_store::load_all(app)
        .ok()?
        .into_iter()
        .find(|saved| saved.provider_id == provider_id)?
        .snapshot
        .lines
        .into_iter()
        .find(|line| line.label == "Plan")
        .map(|line| line.value)
        .filter(|value| !value.trim().is_empty())
}

#[tauri::command]
pub fn list_saved_snapshots(app: tauri::AppHandle) -> Result<Vec<SavedSnapshot>, String> {
    Ok(snapshot_store::load_all(&app).unwrap_or_default())
}

#[tauri::command]
pub fn hide_tray_window(app: tauri::AppHandle) -> Result<(), String> {
    tray::hide_main_window(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn show_tray_window(app: tauri::AppHandle) -> Result<(), String> {
    tray::show_main_window(&app);
    Ok(())
}

#[tauri::command]
pub fn request_tray_close(app: tauri::AppHandle) -> Result<(), String> {
    tray::request_close_animation(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tray_popped_out(app: tauri::AppHandle, popped_out: bool) -> Result<(), String> {
    tray::set_popped_out(&app, popped_out).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_tray_display_mode(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    if mode != "minimal" && mode != "all" {
        return Err("Unknown tray display mode".to_string());
    }

    tray::set_display_mode(&app, &mode).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_glance_visible(
    app: tauri::AppHandle,
    visible: bool,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    tray::set_glance_visible(&app, visible, x, y).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn set_glance_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    tray::set_glance_position(&app, x, y).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn opencode_quota_session_status() -> bool {
    secrets::has_opencode_quota_session()
}

#[tauri::command]
pub fn disconnect_opencode_quota() -> Result<bool, String> {
    secrets::delete_opencode_quota_session().map_err(|error| error.to_string())?;
    Ok(false)
}

#[tauri::command]
pub async fn save_opencode_quota_session(
    app: tauri::AppHandle,
    cookie: String,
    workspace: String,
) -> Result<plugin_host::ProviderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cookie = cookie.trim();
        let workspace_id = workspace_id_from_input(&workspace)?;

        // Tolerate a pasted "Cookie: ..." header line by dropping the label.
        let cookie = cookie
            .strip_prefix("Cookie:")
            .map(str::trim)
            .unwrap_or(cookie);

        if cookie.is_empty() {
            return Err("OpenCode cookie must not be empty".to_string());
        }

        let session = secrets::OpenCodeQuotaSession {
            cookie: cookie.to_string(),
            workspace_id,
        };

        let quota_json =
            opencode_quota::fetch_usage_summary_json(&session.cookie, &session.workspace_id)
                .map_err(|error| provider_error("OpenCode Go", &error))?;

        secrets::save_opencode_quota_session(&session)
            .map_err(|_| "OpenCode Go session could not be saved".to_string())?;
        refresh_opencode_with_quota(app, quota_json)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn refresh_opencode(
    app: tauri::AppHandle,
) -> Result<plugin_host::ProviderSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let session = secrets::load_opencode_quota_session()
            .ok_or_else(|| "OpenCode Go limits are not linked".to_string())?;
        let quota_json =
            opencode_quota::fetch_usage_summary_json(&session.cookie, &session.workspace_id)
                .map_err(|error| provider_error("OpenCode Go", &error))?;

        refresh_opencode_with_quota(app, quota_json)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn refresh_opencode_with_quota(
    app: tauri::AppHandle,
    quota_json: String,
) -> Result<plugin_host::ProviderSnapshot, String> {
    let usage_json = format!("{{\"quota\":{quota_json}}}");

    let snapshot = plugin_host::run_opencode_provider(&OpenCodeHost { usage_json })
        .map_err(|error| internal_error("OpenCode Go", &error))?;
    let _ = snapshot_store::save_latest(&app, &snapshot);
    Ok(snapshot)
}

fn provider_error(provider: &str, error: &impl std::fmt::Display) -> String {
    let message = error.to_string();
    if message.contains("expired") || message.contains("sign in") {
        return message;
    }
    if message.contains("rate limited") {
        return message;
    }
    if message.contains("not found")
        || message.contains("not saved")
        || message.contains("not connected")
        || message.contains("does not contain")
    {
        return message;
    }
    if message.contains("recognizable usage block") {
        return "OpenCode Go limits could not be read from the page".to_string();
    }
    format!("{provider} refresh failed")
}

fn internal_error(provider: &str, _error: &impl std::fmt::Display) -> String {
    format!("{provider} data could not be prepared")
}

fn workspace_id_from_input(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("OpenCode workspace URL or id must not be empty".to_string());
    }

    if trimmed.starts_with("wrk_") {
        return Ok(trimmed.to_string());
    }

    let marker_index = trimmed
        .find(OPENCODE_WORKSPACE_MARKER)
        .ok_or_else(|| "OpenCode workspace must be a workspace URL or wrk_ id".to_string())?;
    let after_marker = &trimmed[marker_index + OPENCODE_WORKSPACE_MARKER.len()..];
    let workspace_id = after_marker
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .trim();

    if workspace_id.starts_with("wrk_") {
        Ok(workspace_id.to_string())
    } else {
        Err("OpenCode workspace id must start with wrk_".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_opencode_workspace_id() {
        assert_eq!(
            workspace_id_from_input("wrk_abc").unwrap(),
            "wrk_abc".to_string()
        );
        assert_eq!(
            workspace_id_from_input("https://opencode.ai/workspace/wrk_abc/go").unwrap(),
            "wrk_abc".to_string()
        );
    }
}
