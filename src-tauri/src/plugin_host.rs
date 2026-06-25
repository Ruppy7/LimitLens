use rquickjs::{prelude::Func, Array, Context, Object, Runtime};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

const PLUGIN_TIMEOUT: Duration = Duration::from_millis(250);
const PLUGIN_MEMORY_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const PLUGIN_STACK_LIMIT_BYTES: usize = 256 * 1024;
const MAX_LINES: usize = 16;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ProviderSnapshot {
    pub provider_id: String,
    pub lines: Vec<MetricLine>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct MetricLine {
    pub label: String,
    pub value: String,
}

pub trait Host {
    fn app_name(&self) -> &'static str;
    fn claude_usage_json(&self) -> String {
        "{}".to_string()
    }
    fn codex_usage_json(&self) -> String {
        "{}".to_string()
    }
    fn deepseek_balance_json(&self) -> String {
        "{}".to_string()
    }
    fn opencode_usage_json(&self) -> String {
        "{}".to_string()
    }
}

const DEEPSEEK_PROVIDER: &str = r#"
function probe(ctx) {
  const balance = JSON.parse(ctx.host.deepseekBalanceJson());
  const usd = (balance.balance_infos ?? []).find(
    (info) => String(info.currency).toUpperCase() === "USD"
  );

  return {
    providerId: "deepseek",
    lines: [
      {
        label: "USD",
        value: usd ? usd.total_balance : "0.00"
      }
    ]
  };
}
"#;

const CODEX_PROVIDER: &str = r#"
function resetText(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const seconds = Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function probe(ctx) {
  const usage = JSON.parse(ctx.host.codexUsageJson());
  const lines = [];

  if (usage.plan_type) {
    lines.push({ label: "Plan", value: String(usage.plan_type) });
  }

  if (usage.session_remaining_percent !== null && usage.session_remaining_percent !== undefined) {
    const reset = usage.session_reset_at ? ` - Resets in ${resetText(usage.session_reset_at)}` : "";
    lines.push({ label: "Session", value: `${usage.session_remaining_percent}%${reset}` });
  }

  if (usage.weekly_remaining_percent !== null && usage.weekly_remaining_percent !== undefined) {
    const reset = usage.weekly_reset_at ? ` - Resets in ${resetText(usage.weekly_reset_at)}` : "";
    lines.push({ label: "Weekly", value: `${usage.weekly_remaining_percent}%${reset}` });
  }

  if (usage.credits_balance !== null && usage.credits_balance !== undefined) {
    lines.push({ label: "Credits", value: String(usage.credits_balance) });
  }

  return {
    providerId: "codex",
    lines
  };
}
"#;

const CLAUDE_PROVIDER: &str = r#"
function resetText(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  const seconds = Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function probe(ctx) {
  const usage = JSON.parse(ctx.host.claudeUsageJson());
  const lines = [];

  if (usage.plan_type) {
    lines.push({ label: "Plan", value: String(usage.plan_type) });
  }

  if (usage.session_remaining_percent !== null && usage.session_remaining_percent !== undefined) {
    const reset = usage.session_reset_at ? ` - Resets in ${resetText(usage.session_reset_at)}` : "";
    lines.push({ label: "Session", value: `${usage.session_remaining_percent}%${reset}` });
  }

  if (usage.weekly_remaining_percent !== null && usage.weekly_remaining_percent !== undefined) {
    const reset = usage.weekly_reset_at ? ` - Resets in ${resetText(usage.weekly_reset_at)}` : "";
    lines.push({ label: "Weekly", value: `${usage.weekly_remaining_percent}%${reset}` });
  }

  return {
    providerId: "claude",
    lines
  };
}
"#;

const OPENCODE_PROVIDER: &str = r#"
function resetText(seconds) {
  if (seconds === null || seconds === undefined) return "";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function quotaLine(label, window) {
  if (!window) return null;
  const used =
    window.usage_percent !== null && window.usage_percent !== undefined
      ? `${window.usage_percent}% used`
      : (window.status || "n/a");
  const reset = window.reset_in_sec !== null && window.reset_in_sec !== undefined
    ? ` - Resets in ${resetText(window.reset_in_sec)}`
    : "";
  return { label, value: `${used}${reset}` };
}

function probe(ctx) {
  const data = JSON.parse(ctx.host.opencodeUsageJson());
  const lines = [];

  const quota = data.quota;
  if (quota) {
    for (const [label, window] of [
      ["Rolling", quota.rolling],
      ["Weekly", quota.weekly],
      ["Monthly", quota.monthly],
    ]) {
      const line = quotaLine(label, window);
      if (line) lines.push(line);
    }
    if (quota.use_balance === true) {
      lines.push({ label: "Mode", value: "Balance" });
    }
  }

  return {
    providerId: "opencode",
    lines
  };
}
"#;

#[derive(Debug)]
pub enum PluginRunError {
    Runtime(rquickjs::Error),
    InvalidOutput(String),
}

impl From<rquickjs::Error> for PluginRunError {
    fn from(error: rquickjs::Error) -> Self {
        Self::Runtime(error)
    }
}

impl std::fmt::Display for PluginRunError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Runtime(error) => write!(formatter, "plugin runtime error: {error}"),
            Self::InvalidOutput(message) => write!(formatter, "invalid plugin output: {message}"),
        }
    }
}

impl std::error::Error for PluginRunError {}

pub fn run_deepseek_provider(host: &impl Host) -> Result<ProviderSnapshot, PluginRunError> {
    run_provider(DEEPSEEK_PROVIDER, host)
}

pub fn run_codex_provider(host: &impl Host) -> Result<ProviderSnapshot, PluginRunError> {
    run_provider(CODEX_PROVIDER, host)
}

pub fn run_claude_provider(host: &impl Host) -> Result<ProviderSnapshot, PluginRunError> {
    run_provider(CLAUDE_PROVIDER, host)
}

pub fn run_opencode_provider(host: &impl Host) -> Result<ProviderSnapshot, PluginRunError> {
    run_provider(OPENCODE_PROVIDER, host)
}

pub fn run_provider(source: &str, host: &impl Host) -> Result<ProviderSnapshot, PluginRunError> {
    let runtime = Runtime::new()?;
    runtime.set_memory_limit(PLUGIN_MEMORY_LIMIT_BYTES);
    runtime.set_max_stack_size(PLUGIN_STACK_LIMIT_BYTES);

    let started_at = Instant::now();
    runtime.set_interrupt_handler(Some(Box::new(move || {
        started_at.elapsed() > PLUGIN_TIMEOUT
    })));

    let context = Context::full(&runtime)?;
    let app_name = host.app_name().to_string();
    let claude_usage_json = host.claude_usage_json();
    let codex_usage_json = host.codex_usage_json();
    let deepseek_balance_json = host.deepseek_balance_json();
    let opencode_usage_json = host.opencode_usage_json();

    context.with(|ctx| -> Result<ProviderSnapshot, PluginRunError> {
        let host = Object::new(ctx.clone())?;
        host.set("appName", Func::new(move || app_name.clone()))?;
        host.set(
            "claudeUsageJson",
            Func::new(move || claude_usage_json.clone()),
        )?;
        host.set(
            "codexUsageJson",
            Func::new(move || codex_usage_json.clone()),
        )?;
        host.set(
            "deepseekBalanceJson",
            Func::new(move || deepseek_balance_json.clone()),
        )?;
        host.set(
            "opencodeUsageJson",
            Func::new(move || opencode_usage_json.clone()),
        )?;

        let plugin_context = Object::new(ctx.clone())?;
        plugin_context.set("host", host)?;
        ctx.globals().set("ctx", plugin_context)?;

        ctx.eval::<(), _>(source)?;
        let snapshot = ctx.eval::<Object, _>("probe(ctx)")?;
        let provider_id: String = snapshot.get("providerId")?;
        let lines_array = snapshot.get::<_, Array>("lines")?;

        if provider_id.trim().is_empty() {
            return Err(PluginRunError::InvalidOutput(
                "providerId must not be empty".to_string(),
            ));
        }

        if lines_array.len() > MAX_LINES {
            return Err(PluginRunError::InvalidOutput(format!(
                "provider returned more than {MAX_LINES} lines"
            )));
        }

        let lines = lines_array
            .iter::<Object>()
            .map(|line| {
                let line = line?;
                let label: String = line.get("label")?;
                let value: String = line.get("value")?;

                if label.trim().is_empty() {
                    return Err(PluginRunError::InvalidOutput(
                        "line label must not be empty".to_string(),
                    ));
                }

                Ok(MetricLine { label, value })
            })
            .collect::<Result<Vec<_>, PluginRunError>>()?;

        Ok(ProviderSnapshot { provider_id, lines })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeHost {
        claude_usage_json: String,
        codex_usage_json: String,
        deepseek_balance_json: String,
        opencode_usage_json: String,
    }

    impl Host for FakeHost {
        fn app_name(&self) -> &'static str {
            "InfUsage"
        }

        fn claude_usage_json(&self) -> String {
            self.claude_usage_json.clone()
        }

        fn codex_usage_json(&self) -> String {
            self.codex_usage_json.clone()
        }

        fn deepseek_balance_json(&self) -> String {
            self.deepseek_balance_json.clone()
        }

        fn opencode_usage_json(&self) -> String {
            self.opencode_usage_json.clone()
        }
    }

    #[test]
    fn rejects_empty_provider_id() {
        let error = run_provider(
            r#"
            function probe(ctx) {
              return { providerId: "", lines: [] };
            }
            "#,
            &FakeHost::default(),
        )
        .expect_err("empty provider id should fail");

        assert!(matches!(error, PluginRunError::InvalidOutput(_)));
    }

    #[test]
    fn interrupts_runaway_plugin() {
        let error = run_provider(
            r#"
            function probe(ctx) {
              while (true) {}
            }
            "#,
            &FakeHost::default(),
        )
        .expect_err("runaway plugin should fail");

        assert!(matches!(error, PluginRunError::Runtime(_)));
    }

    #[test]
    fn deepseek_provider_normalizes_balance_lines() {
        let host = FakeHost {
            claude_usage_json: "{}".to_string(),
            codex_usage_json: "{}".to_string(),
            deepseek_balance_json: r#"
            {
              "is_available": true,
              "balance_infos": [
                {
                  "currency": "USD",
                  "total_balance": "12.50",
                  "granted_balance": "2.50",
                  "topped_up_balance": "10.00"
                }
              ]
            }
            "#
            .to_string(),
            opencode_usage_json: "{}".to_string(),
        };

        let snapshot = run_deepseek_provider(&host).expect("DeepSeek plugin should run");

        assert_eq!(
            snapshot,
            ProviderSnapshot {
                provider_id: "deepseek".to_string(),
                lines: vec![MetricLine {
                    label: "USD".to_string(),
                    value: "12.50".to_string(),
                }],
            }
        );
    }

    #[test]
    fn codex_provider_normalizes_usage_lines() {
        let host = FakeHost {
            claude_usage_json: "{}".to_string(),
            codex_usage_json: r#"
            {
              "plan_type": "pro",
              "session_remaining_percent": 12.5,
              "session_reset_at": 1782229464,
              "weekly_remaining_percent": 50,
              "weekly_reset_at": 1782557292,
              "credits_balance": 9
            }
            "#
            .to_string(),
            deepseek_balance_json: "{}".to_string(),
            opencode_usage_json: "{}".to_string(),
        };

        let snapshot = run_codex_provider(&host).expect("Codex plugin should run");

        assert_eq!(snapshot.provider_id, "codex".to_string());
        assert_eq!(snapshot.lines.len(), 4);
        assert_eq!(snapshot.lines[0].label, "Plan");
        assert_eq!(snapshot.lines[1].label, "Session");
        assert!(snapshot.lines[1].value.starts_with("12.5% - Resets in "));
        assert_eq!(snapshot.lines[2].label, "Weekly");
        assert!(snapshot.lines[2].value.starts_with("50% - Resets in "));
        assert_eq!(snapshot.lines[3].label, "Credits");
    }

    #[test]
    fn claude_provider_normalizes_usage_lines() {
        let host = FakeHost {
            claude_usage_json: r#"
            {
              "plan_type": "pro 5x",
              "session_remaining_percent": 75,
              "session_reset_at": "2099-01-01T00:00:00.000Z",
              "weekly_remaining_percent": 60,
              "weekly_reset_at": "2099-01-07T00:00:00.000Z"
            }
            "#
            .to_string(),
            codex_usage_json: "{}".to_string(),
            deepseek_balance_json: "{}".to_string(),
            opencode_usage_json: "{}".to_string(),
        };

        let snapshot = run_claude_provider(&host).expect("Claude plugin should run");

        assert_eq!(snapshot.provider_id, "claude".to_string(),);
        assert_eq!(snapshot.lines.len(), 3);
        assert_eq!(snapshot.lines[0].label, "Plan");
        assert_eq!(snapshot.lines[1].label, "Session");
        assert!(snapshot.lines[1].value.starts_with("75% - "));
        assert_eq!(snapshot.lines[2].label, "Weekly");
        assert!(snapshot.lines[2].value.starts_with("60% - "));
    }

    #[test]
    fn opencode_provider_shows_no_lines_without_quota() {
        let host = FakeHost {
            opencode_usage_json: r#"{"quota": null}"#.to_string(),
            ..Default::default()
        };

        let snapshot = run_opencode_provider(&host).expect("OpenCode plugin should run");

        assert_eq!(
            snapshot,
            ProviderSnapshot {
                provider_id: "opencode".to_string(),
                lines: vec![],
            }
        );
    }

    #[test]
    fn opencode_provider_appends_quota_when_present() {
        let host = FakeHost {
            opencode_usage_json: r#"
            {
              "quota": {
                "use_balance": false,
                "rolling": { "status": "ok", "reset_in_sec": 18000, "usage_percent": 0 },
                "weekly": { "status": "ok", "reset_in_sec": 451207, "usage_percent": 2 },
                "monthly": { "status": "ok", "reset_in_sec": 1194765, "usage_percent": 9 }
              }
            }
            "#
            .to_string(),
            ..Default::default()
        };

        let snapshot = run_opencode_provider(&host).expect("OpenCode plugin should run");
        let labels = snapshot
            .lines
            .iter()
            .map(|line| line.label.as_str())
            .collect::<Vec<_>>();

        assert_eq!(labels, vec!["Rolling", "Weekly", "Monthly"]);
        assert_eq!(snapshot.lines[0].value, "0% used - Resets in 5h 0m");
        assert_eq!(snapshot.lines[2].value, "9% used - Resets in 13d 19h");
    }
}
