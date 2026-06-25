use reqwest::{blocking::Client, header::HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
    time::Duration,
};

const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_URL: &str = "https://auth.openai.com/oauth/token";
const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, PartialEq)]
struct CodexTokens {
    access_token: String,
    refresh_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug)]
struct CodexAuth {
    path: PathBuf,
    json: Value,
    tokens: CodexTokens,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct UsageSummary {
    pub plan_type: Option<String>,
    pub session_remaining_percent: Option<f64>,
    pub session_reset_at: Option<i64>,
    pub weekly_remaining_percent: Option<f64>,
    pub weekly_reset_at: Option<i64>,
    pub credits_balance: Option<f64>,
}

#[derive(Debug)]
pub enum CodexError {
    Http(reqwest::Error),
    Io(io::Error),
    Json(serde_json::Error),
    MissingAuth,
    MissingTokens,
    Unauthorized,
}

impl From<reqwest::Error> for CodexError {
    fn from(error: reqwest::Error) -> Self {
        Self::Http(error)
    }
}

impl From<io::Error> for CodexError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for CodexError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for CodexError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(formatter, "Codex HTTP error: {error}"),
            Self::Io(error) => write!(formatter, "Codex auth file error: {error}"),
            Self::Json(error) => write!(formatter, "Codex JSON error: {error}"),
            Self::MissingAuth => write!(formatter, "Codex auth.json was not found"),
            Self::MissingTokens => {
                write!(formatter, "Codex auth.json does not contain login tokens")
            }
            Self::Unauthorized => {
                write!(formatter, "Codex login expired; run Codex again to sign in")
            }
        }
    }
}

impl std::error::Error for CodexError {}

pub fn fetch_usage_summary_json() -> Result<String, CodexError> {
    let mut auth = load_auth()?;
    let client = Client::builder().timeout(REQUEST_TIMEOUT).build()?;

    match fetch_usage_summary(&client, &auth.tokens)? {
        FetchResult::Ok(summary) => Ok(serde_json::to_string(&summary)?),
        FetchResult::Unauthorized => {
            refresh_auth(&client, &mut auth)?;
            match fetch_usage_summary(&client, &auth.tokens)? {
                FetchResult::Ok(summary) => Ok(serde_json::to_string(&summary)?),
                FetchResult::Unauthorized => Err(CodexError::Unauthorized),
            }
        }
    }
}

pub fn parse_usage_summary(json: &str) -> Result<UsageSummary, CodexError> {
    Ok(serde_json::from_str(json)?)
}

enum FetchResult {
    Ok(UsageSummary),
    Unauthorized,
}

fn fetch_usage_summary(client: &Client, tokens: &CodexTokens) -> Result<FetchResult, CodexError> {
    let mut request = client.get(USAGE_URL).bearer_auth(&tokens.access_token);

    if let Some(account_id) = &tokens.account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }

    let response = request.send()?;
    let status = response.status();

    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return Ok(FetchResult::Unauthorized);
    }

    let headers = response.headers().clone();
    let body = response.error_for_status()?.json::<Value>()?;

    Ok(FetchResult::Ok(summarize_usage(&body, &headers)))
}

fn refresh_auth(client: &Client, auth: &mut CodexAuth) -> Result<(), CodexError> {
    let refresh_token = auth
        .tokens
        .refresh_token
        .as_ref()
        .ok_or(CodexError::Unauthorized)?;

    let response = client
        .post(REFRESH_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("refresh_token", refresh_token),
        ])
        .send()?;

    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Err(CodexError::Unauthorized);
    }

    let refreshed = response.error_for_status()?.json::<Value>()?;
    let access_token = refreshed
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or(CodexError::MissingTokens)?
        .to_string();

    auth.json["tokens"]["access_token"] = Value::String(access_token);

    if let Some(refresh_token) = refreshed.get("refresh_token").and_then(Value::as_str) {
        auth.json["tokens"]["refresh_token"] = Value::String(refresh_token.to_string());
    }

    if let Some(id_token) = refreshed.get("id_token").and_then(Value::as_str) {
        auth.json["tokens"]["id_token"] = Value::String(id_token.to_string());
    }

    auth.tokens = tokens_from_json(&auth.json)?;
    fs::write(&auth.path, serde_json::to_vec_pretty(&auth.json)?)?;

    Ok(())
}

fn load_auth() -> Result<CodexAuth, CodexError> {
    for path in auth_paths() {
        if !path.exists() {
            continue;
        }

        let json = serde_json::from_slice::<Value>(&fs::read(&path)?)?;
        let tokens = tokens_from_json(&json)?;

        return Ok(CodexAuth { path, json, tokens });
    }

    Err(CodexError::MissingAuth)
}

fn auth_paths() -> Vec<PathBuf> {
    if let Some(codex_home) = non_empty_env_path("CODEX_HOME") {
        return vec![codex_home.join("auth.json")];
    }

    let mut paths = Vec::new();

    if let Some(home) = non_empty_env_path("USERPROFILE").or_else(|| non_empty_env_path("HOME")) {
        paths.push(home.join(".config").join("codex").join("auth.json"));
        paths.push(home.join(".codex").join("auth.json"));
    }

    paths
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

fn tokens_from_json(json: &Value) -> Result<CodexTokens, CodexError> {
    serde_json::from_value(
        json.get("tokens")
            .cloned()
            .ok_or(CodexError::MissingTokens)?,
    )
    .map_err(|_| CodexError::MissingTokens)
}

fn summarize_usage(body: &Value, headers: &HeaderMap) -> UsageSummary {
    let session_used_percent = header_f64(headers, "x-codex-primary-used-percent")
        .or_else(|| nested_f64(body, &["rate_limit", "primary_window", "used_percent"]));
    let weekly_used_percent = header_f64(headers, "x-codex-secondary-used-percent")
        .or_else(|| nested_f64(body, &["rate_limit", "secondary_window", "used_percent"]));

    UsageSummary {
        plan_type: body
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        session_remaining_percent: session_used_percent.map(remaining_percent),
        session_reset_at: nested_i64(body, &["rate_limit", "primary_window", "reset_at"]),
        weekly_remaining_percent: weekly_used_percent.map(remaining_percent),
        weekly_reset_at: nested_i64(body, &["rate_limit", "secondary_window", "reset_at"]),
        credits_balance: credits_balance(body, headers),
    }
}

fn remaining_percent(used_percent: f64) -> f64 {
    (100.0 - used_percent).clamp(0.0, 100.0)
}

fn credits_balance(body: &Value, headers: &HeaderMap) -> Option<f64> {
    if body
        .get("credits")
        .and_then(|credits| credits.get("has_credits"))
        .and_then(Value::as_bool)
        == Some(false)
    {
        return None;
    }

    header_f64(headers, "x-codex-credits-balance")
        .or_else(|| nested_f64(body, &["credits", "balance"]))
}

fn nested_f64(value: &Value, path: &[&str]) -> Option<f64> {
    path.iter()
        .try_fold(value, |next, key| next.get(*key))
        .and_then(json_f64)
}

fn nested_i64(value: &Value, path: &[&str]) -> Option<i64> {
    path.iter()
        .try_fold(value, |next, key| next.get(*key))
        .and_then(json_i64)
}

fn json_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
}

fn json_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|text| text.parse::<i64>().ok()))
}

fn header_f64(headers: &HeaderMap, key: &'static str) -> Option<f64> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<f64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn summarizes_usage_body_and_headers() {
        let body = serde_json::json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": { "used_percent": 12.5, "reset_at": 1782229464 },
                "secondary_window": { "used_percent": "33.5", "reset_at": "1782557292" }
            },
            "credits": { "balance": 10 }
        });
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-codex-primary-used-percent",
            HeaderValue::from_static("13.5"),
        );

        assert_eq!(
            summarize_usage(&body, &headers),
            UsageSummary {
                plan_type: Some("pro".to_string()),
                session_remaining_percent: Some(86.5),
                session_reset_at: Some(1782229464),
                weekly_remaining_percent: Some(66.5),
                weekly_reset_at: Some(1782557292),
                credits_balance: Some(10.0),
            }
        );
    }

    #[test]
    fn parses_summary_json() {
        assert_eq!(
            parse_usage_summary(
                r#"{"plan_type":"pro","session_remaining_percent":1,"session_reset_at":1782229464,"weekly_remaining_percent":2,"weekly_reset_at":1782557292,"credits_balance":3}"#
            )
            .expect("summary should parse"),
            UsageSummary {
                plan_type: Some("pro".to_string()),
                session_remaining_percent: Some(1.0),
                session_reset_at: Some(1782229464),
                weekly_remaining_percent: Some(2.0),
                weekly_reset_at: Some(1782557292),
                credits_balance: Some(3.0),
            }
        );
    }

    #[test]
    fn hides_missing_credits() {
        let body = serde_json::json!({
            "credits": { "has_credits": false, "balance": "0" }
        });

        assert_eq!(
            summarize_usage(&body, &HeaderMap::new()).credits_balance,
            None
        );
    }
}
