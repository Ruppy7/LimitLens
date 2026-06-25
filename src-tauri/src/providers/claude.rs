use reqwest::{blocking::Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const SCOPES: &str =
    "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const REFRESH_BUFFER_MS: u64 = 5 * 60 * 1000;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeOauth {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    subscription_type: Option<String>,
    rate_limit_tier: Option<String>,
    scopes: Option<Vec<String>>,
}

#[derive(Debug)]
struct ClaudeAuth {
    path: PathBuf,
    json: Value,
    oauth: ClaudeOauth,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct UsageSummary {
    pub plan_type: Option<String>,
    pub session_remaining_percent: Option<f64>,
    pub session_reset_at: Option<String>,
    pub weekly_remaining_percent: Option<f64>,
    pub weekly_reset_at: Option<String>,
}

#[derive(Debug)]
pub enum ClaudeError {
    Http(reqwest::Error),
    Io(io::Error),
    Json(serde_json::Error),
    MissingAuth,
    MissingTokens,
    Unauthorized,
}

impl From<reqwest::Error> for ClaudeError {
    fn from(error: reqwest::Error) -> Self {
        Self::Http(error)
    }
}

impl From<io::Error> for ClaudeError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ClaudeError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for ClaudeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(formatter, "Claude HTTP error: {error}"),
            Self::Io(error) => write!(formatter, "Claude credentials file error: {error}"),
            Self::Json(error) => write!(formatter, "Claude JSON error: {error}"),
            Self::MissingAuth => write!(formatter, "Claude credentials were not found"),
            Self::MissingTokens => write!(
                formatter,
                "Claude credentials do not contain Claude Code OAuth tokens"
            ),
            Self::Unauthorized => write!(formatter, "Claude login expired; run claude to sign in"),
        }
    }
}

impl std::error::Error for ClaudeError {}

pub fn fetch_usage_summary_json() -> Result<String, ClaudeError> {
    let mut auth = load_auth()?;
    let client = Client::builder().timeout(REQUEST_TIMEOUT).build()?;

    if needs_refresh(&auth.oauth) {
        refresh_auth(&client, &mut auth)?;
    }

    if !has_profile_scope(&auth.oauth) {
        return Ok(serde_json::to_string(&UsageSummary {
            plan_type: plan_label(&auth.oauth),
            session_remaining_percent: None,
            session_reset_at: None,
            weekly_remaining_percent: None,
            weekly_reset_at: None,
        })?);
    }

    match fetch_usage_summary(&client, &auth.oauth)? {
        FetchResult::Ok(summary) => Ok(serde_json::to_string(&summary)?),
        FetchResult::Unauthorized => {
            refresh_auth(&client, &mut auth)?;
            match fetch_usage_summary(&client, &auth.oauth)? {
                FetchResult::Ok(summary) => Ok(serde_json::to_string(&summary)?),
                FetchResult::Unauthorized => Err(ClaudeError::Unauthorized),
            }
        }
    }
}

enum FetchResult {
    Ok(UsageSummary),
    Unauthorized,
}

fn fetch_usage_summary(client: &Client, oauth: &ClaudeOauth) -> Result<FetchResult, ClaudeError> {
    let response = client
        .get(USAGE_URL)
        .bearer_auth(&oauth.access_token)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/2.1.69")
        .send()?;
    let status = response.status();

    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return Ok(FetchResult::Unauthorized);
    }

    let body = response.error_for_status()?.json::<Value>()?;

    Ok(FetchResult::Ok(summarize_usage(&body, oauth)))
}

fn refresh_auth(client: &Client, auth: &mut ClaudeAuth) -> Result<(), ClaudeError> {
    let refresh_token = auth
        .oauth
        .refresh_token
        .as_ref()
        .ok_or(ClaudeError::Unauthorized)?;

    let response = client
        .post(REFRESH_URL)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
            "scope": SCOPES,
        }))
        .send()?;

    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::BAD_REQUEST
    ) {
        return Err(ClaudeError::Unauthorized);
    }

    let refreshed = response.error_for_status()?.json::<Value>()?;
    let access_token = refreshed
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or(ClaudeError::MissingTokens)?
        .to_string();

    auth.json["claudeAiOauth"]["accessToken"] = Value::String(access_token);

    if let Some(refresh_token) = refreshed.get("refresh_token").and_then(Value::as_str) {
        auth.json["claudeAiOauth"]["refreshToken"] = Value::String(refresh_token.to_string());
    }

    if let Some(expires_in) = refreshed.get("expires_in").and_then(Value::as_u64) {
        auth.json["claudeAiOauth"]["expiresAt"] =
            Value::from(now_ms().saturating_add(expires_in * 1000));
    }

    auth.oauth = oauth_from_json(&auth.json)?;
    fs::write(&auth.path, serde_json::to_vec(&auth.json)?)?;

    Ok(())
}

fn load_auth() -> Result<ClaudeAuth, ClaudeError> {
    let path = auth_path().ok_or(ClaudeError::MissingAuth)?;

    if !path.exists() {
        return Err(ClaudeError::MissingAuth);
    }

    let json = serde_json::from_slice::<Value>(&fs::read(&path)?)?;
    let oauth = oauth_from_json(&json)?;

    Ok(ClaudeAuth { path, json, oauth })
}

fn auth_path() -> Option<PathBuf> {
    if let Some(path) = non_empty_env_path("CLAUDE_CREDENTIALS_FILE") {
        return Some(path);
    }

    let mut candidates = Vec::new();

    if let Some(config_dir) = non_empty_env_path("CLAUDE_CONFIG_DIR") {
        candidates.push(config_dir.join(".credentials.json"));
    }

    if let Some(home) = non_empty_env_path("USERPROFILE").or_else(|| non_empty_env_path("HOME")) {
        candidates.push(home.join(".claude").join(".credentials.json"));
    }

    candidates.extend(wsl_home_candidates(&[".claude", ".credentials.json"]));
    if let Some(path) = wsl_home_file(&[".claude", ".credentials.json"]) {
        candidates.push(path);
    }

    newest_existing(candidates)
}

fn non_empty_env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).and_then(|value| {
        if value.is_empty() {
            None
        } else {
            Some(Path::new(&value).to_path_buf())
        }
    })
}

fn wsl_home_candidates(parts: &[&str]) -> Vec<PathBuf> {
    ["\\\\wsl.localhost", "\\\\wsl$"]
        .into_iter()
        .map(PathBuf::from)
        .flat_map(|root| {
            fs::read_dir(root)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
        })
        .flat_map(|distro| {
            let distro_path = distro.path();
            let home_dirs = fs::read_dir(distro_path.join("home"))
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .map(|entry| entry.path());
            home_dirs.chain(std::iter::once(distro_path.join("root")))
        })
        .map(|home| parts.iter().fold(home, |path, part| path.join(part)))
        .collect()
}

fn wsl_home_file(parts: &[&str]) -> Option<PathBuf> {
    let linux_path = parts.join("/");
    let output = Command::new("wsl.exe")
        .args(["--cd", "~", "wslpath", "-w", &linux_path])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

fn newest_existing(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .into_iter()
        .filter(|path| path.exists())
        .max_by_key(|path| {
            fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH)
        })
}

fn oauth_from_json(json: &Value) -> Result<ClaudeOauth, ClaudeError> {
    serde_json::from_value(
        json.get("claudeAiOauth")
            .cloned()
            .ok_or(ClaudeError::MissingTokens)?,
    )
    .map_err(|_| ClaudeError::MissingTokens)
}

fn needs_refresh(oauth: &ClaudeOauth) -> bool {
    oauth
        .expires_at
        .is_some_and(|expires_at| expires_at <= now_ms().saturating_add(REFRESH_BUFFER_MS))
}

fn has_profile_scope(oauth: &ClaudeOauth) -> bool {
    oauth
        .scopes
        .as_ref()
        .map(|scopes| scopes.iter().any(|scope| scope == "user:profile"))
        .unwrap_or(true)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn summarize_usage(body: &Value, oauth: &ClaudeOauth) -> UsageSummary {
    let session_used_percent = nested_f64(body, &["five_hour", "utilization"]);
    let weekly_used_percent = nested_f64(body, &["seven_day", "utilization"]);

    UsageSummary {
        plan_type: plan_label(oauth),
        session_remaining_percent: session_used_percent.map(remaining_percent),
        session_reset_at: nested_string(body, &["five_hour", "resets_at"]),
        weekly_remaining_percent: weekly_used_percent.map(remaining_percent),
        weekly_reset_at: nested_string(body, &["seven_day", "resets_at"]),
    }
}

fn plan_label(oauth: &ClaudeOauth) -> Option<String> {
    let subscription = oauth.subscription_type.as_ref()?.trim();
    if subscription.is_empty() {
        return None;
    }

    let mut label = subscription.to_string();

    if let Some(tier) = oauth
        .rate_limit_tier
        .as_ref()
        .and_then(|tier| tier_suffix(tier))
    {
        label.push(' ');
        label.push_str(&tier);
    }

    Some(label)
}

fn tier_suffix(tier: &str) -> Option<String> {
    let start = tier.find(|character: char| character.is_ascii_digit())?;
    let end = tier[start..]
        .find('x')
        .map(|index| start + index + 1)
        .unwrap_or(tier.len());

    Some(tier[start..end].to_string())
}

fn remaining_percent(used_percent: f64) -> f64 {
    (100.0 - used_percent).clamp(0.0, 100.0)
}

fn nested_f64(value: &Value, path: &[&str]) -> Option<f64> {
    path.iter()
        .try_fold(value, |next, key| next.get(*key))
        .and_then(json_f64)
}

fn nested_string(value: &Value, path: &[&str]) -> Option<String> {
    path.iter()
        .try_fold(value, |next, key| next.get(*key))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn json_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_usage_windows() {
        let oauth = ClaudeOauth {
            access_token: "token".to_string(),
            refresh_token: None,
            expires_at: None,
            subscription_type: Some("pro".to_string()),
            rate_limit_tier: Some("tier_5x".to_string()),
            scopes: None,
        };
        let body = serde_json::json!({
            "five_hour": {
                "utilization": 25,
                "resets_at": "2099-01-01T00:00:00.000Z"
            },
            "seven_day": {
                "utilization": "40",
                "resets_at": "2099-01-07T00:00:00.000Z"
            }
        });

        assert_eq!(
            summarize_usage(&body, &oauth),
            UsageSummary {
                plan_type: Some("pro 5x".to_string()),
                session_remaining_percent: Some(75.0),
                session_reset_at: Some("2099-01-01T00:00:00.000Z".to_string()),
                weekly_remaining_percent: Some(60.0),
                weekly_reset_at: Some("2099-01-07T00:00:00.000Z".to_string()),
            }
        );
    }

    #[test]
    fn respects_missing_profile_scope() {
        let oauth = ClaudeOauth {
            access_token: "token".to_string(),
            refresh_token: None,
            expires_at: None,
            subscription_type: None,
            rate_limit_tier: None,
            scopes: Some(vec!["user:inference".to_string()]),
        };

        assert!(!has_profile_scope(&oauth));
    }
}
