use reqwest::{blocking::Client, StatusCode};
use serde::{Deserialize, Serialize};
use std::{io, time::Duration};

const WORKSPACE_BASE: &str = "https://opencode.ai/workspace";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct UsageWindow {
    pub status: Option<String>,
    pub reset_in_sec: Option<i64>,
    pub usage_percent: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct UsageSummary {
    pub use_balance: Option<bool>,
    pub rolling: Option<UsageWindow>,
    pub weekly: Option<UsageWindow>,
    pub monthly: Option<UsageWindow>,
}

#[derive(Debug)]
pub enum OpenCodeQuotaError {
    Http(reqwest::Error),
    Io(io::Error),
    Json(serde_json::Error),
    MissingSession,
    Unauthorized,
    UnexpectedShape,
}

impl From<reqwest::Error> for OpenCodeQuotaError {
    fn from(error: reqwest::Error) -> Self {
        Self::Http(error)
    }
}

impl From<io::Error> for OpenCodeQuotaError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for OpenCodeQuotaError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for OpenCodeQuotaError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(error) => write!(formatter, "OpenCode quota HTTP error: {error}"),
            Self::Io(error) => write!(formatter, "OpenCode quota session error: {error}"),
            Self::Json(error) => write!(formatter, "OpenCode quota JSON error: {error}"),
            Self::MissingSession => write!(formatter, "OpenCode quota session is not connected"),
            Self::Unauthorized => write!(
                formatter,
                "OpenCode quota session expired; paste a fresh browser cookie"
            ),
            Self::UnexpectedShape => write!(
                formatter,
                "OpenCode quota page did not contain a recognizable usage block"
            ),
        }
    }
}

impl std::error::Error for OpenCodeQuotaError {}

pub fn fetch_usage_summary_json(
    session_cookie: &str,
    workspace_id: &str,
) -> Result<String, OpenCodeQuotaError> {
    if session_cookie.trim().is_empty() || workspace_id.trim().is_empty() {
        return Err(OpenCodeQuotaError::MissingSession);
    }

    let client = Client::builder().timeout(REQUEST_TIMEOUT).build()?;
    let url = format!("{WORKSPACE_BASE}/{workspace_id}/go");

    let response = client
        .get(url)
        .header(reqwest::header::COOKIE, session_cookie)
        .header(reqwest::header::ACCEPT, "text/html,*/*")
        .header(reqwest::header::CACHE_CONTROL, "no-cache")
        .send()?;

    let status = response.status();
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return Err(OpenCodeQuotaError::Unauthorized);
    }

    let body = response.error_for_status()?.text()?;
    let summary = parse_usage_from_page(&body)?;
    Ok(serde_json::to_string(&summary)?)
}

pub fn parse_usage_from_page(page: &str) -> Result<UsageSummary, OpenCodeQuotaError> {
    let rolling = window_for_labels(page, &["rollingUsage", "rollingLimit"]);
    let weekly = window_for_labels(page, &["weeklyUsage", "weeklyLimit"]);
    let monthly = window_for_labels(page, &["monthlyUsage", "monthlyLimit"]);
    let use_balance = bool_after(page, "useBalance");

    if rolling.is_none() && weekly.is_none() && monthly.is_none() {
        return Err(OpenCodeQuotaError::UnexpectedShape);
    }

    Ok(UsageSummary {
        use_balance,
        rolling,
        weekly,
        monthly,
    })
}

fn window_for_labels(page: &str, labels: &[&str]) -> Option<UsageWindow> {
    labels
        .iter()
        .find_map(|label| window_for_label(page, label))
}

fn window_for_label(page: &str, label: &str) -> Option<UsageWindow> {
    const LABELS: [&str; 6] = [
        "rollingUsage",
        "rollingLimit",
        "weeklyUsage",
        "weeklyLimit",
        "monthlyUsage",
        "monthlyLimit",
    ];

    let mut search_from = 0;
    while let Some(pos) = page[search_from..].find(label) {
        let start = search_from + pos + label.len();
        let end = LABELS
            .iter()
            .filter(|other| **other != label)
            .filter_map(|other| page[start..].find(other).map(|next_pos| start + next_pos))
            .min()
            .unwrap_or(page.len());
        let slice = &page[start..end];

        let window = UsageWindow {
            status: string_after(slice, "status"),
            reset_in_sec: number_after(slice, "resetInSec").and_then(|raw| raw.parse::<i64>().ok()),
            usage_percent: number_after(slice, "usagePercent")
                .and_then(|raw| raw.parse::<f64>().ok()),
        };

        if window != UsageWindow::default() {
            return Some(window);
        }

        search_from = start;
    }

    None
}

fn raw_value_after<'a>(slice: &'a str, key: &str) -> Option<&'a str> {
    let pos = slice.find(key)? + key.len();
    let after = slice[pos..].trim_start();
    let after = after
        .strip_prefix('"')
        .or_else(|| after.strip_prefix('\''))
        .unwrap_or(after)
        .trim_start();
    let after = after.strip_prefix(':')?.trim_start();
    let end = after
        .find(|c| c == ',' || c == '}' || c == '\n' || c == ';')
        .unwrap_or(after.len());
    Some(after[..end].trim())
}

fn number_after(slice: &str, key: &str) -> Option<String> {
    let raw = raw_value_after(slice, key)?;
    let number: String = raw
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    (!number.is_empty()).then_some(number)
}

fn string_after(slice: &str, key: &str) -> Option<String> {
    let raw = raw_value_after(slice, key)?;
    let trimmed = raw.trim_matches(|c| c == '"' || c == '\'');
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn bool_after(slice: &str, key: &str) -> Option<bool> {
    match raw_value_after(slice, key)? {
        "true" | "!0" => Some(true),
        "false" | "!1" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_PAGE: &str = r#"
        $R[28]($R[18], $R[34] = {
            mine: !0,
            useBalance: !1,
            rollingUsage: $R[35] = {
                status: "ok",
                resetInSec: 18000,
                usagePercent: 0
            },
            weeklyUsage: $R[36] = {
                status: "ok",
                resetInSec: 451207,
                usagePercent: 2
            },
            monthlyUsage: $R[37] = {
                status: "ok",
                resetInSec: 1194765,
                usagePercent: 9
            }
        });
    "#;

    #[test]
    fn parses_real_console_payload() {
        let summary = parse_usage_from_page(SAMPLE_PAGE).expect("sample should parse");

        assert_eq!(
            summary,
            UsageSummary {
                use_balance: Some(false),
                rolling: Some(UsageWindow {
                    status: Some("ok".to_string()),
                    reset_in_sec: Some(18000),
                    usage_percent: Some(0.0),
                }),
                weekly: Some(UsageWindow {
                    status: Some("ok".to_string()),
                    reset_in_sec: Some(451207),
                    usage_percent: Some(2.0),
                }),
                monthly: Some(UsageWindow {
                    status: Some("ok".to_string()),
                    reset_in_sec: Some(1194765),
                    usage_percent: Some(9.0),
                }),
            }
        );
    }

    #[test]
    fn parses_limit_aliases() {
        let page = r#"
            {
                useBalance: !1,
                rollingLimit: { status: "ok", resetInSec: 18000, usagePercent: 1 },
                weeklyLimit: { status: "ok", resetInSec: 451207, usagePercent: 2 },
                monthlyLimit: { status: "ok", resetInSec: 1194765, usagePercent: 9 }
            }
        "#;

        let summary = parse_usage_from_page(page).expect("limit aliases should parse");

        assert_eq!(
            summary.monthly,
            Some(UsageWindow {
                status: Some("ok".to_string()),
                reset_in_sec: Some(1194765),
                usage_percent: Some(9.0),
            })
        );
    }

    #[test]
    fn parses_quoted_json_keys() {
        let page = r#"
            {
                "useBalance": false,
                "monthlyUsage": { "status": "ok", "resetInSec": 1194765, "usagePercent": 9 }
            }
        "#;

        let summary = parse_usage_from_page(page).expect("quoted keys should parse");

        assert_eq!(
            summary.monthly,
            Some(UsageWindow {
                status: Some("ok".to_string()),
                reset_in_sec: Some(1194765),
                usage_percent: Some(9.0),
            })
        );
    }

    #[test]
    fn skips_label_references_before_usage_window() {
        let page = r#"
            const labels = { monthlyUsage: "Monthly" };
            $R[28]($R[18], $R[34] = {
                monthlyUsage: $R[37] = {
                    status: "ok",
                    resetInSec: 1194765,
                    usagePercent: 9
                }
            });
        "#;

        let summary = parse_usage_from_page(page).expect("later monthly window should parse");

        assert_eq!(
            summary.monthly,
            Some(UsageWindow {
                status: Some("ok".to_string()),
                reset_in_sec: Some(1194765),
                usage_percent: Some(9.0),
            })
        );
    }

    #[test]
    fn fails_visibly_when_no_usage_block() {
        let error = parse_usage_from_page("<html>signed out</html>")
            .expect_err("missing usage block should error");
        assert!(matches!(error, OpenCodeQuotaError::UnexpectedShape));
    }
}
