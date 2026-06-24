use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Spend/token totals computed locally from OpenCode's SQLite database. This is
/// the zero-auth, this-device view (the metric every other OpenCode tracker
/// ships); it is not the subscription quota that the console reports.
#[derive(Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct SpendSummary {
    pub cost_7d: f64,
    pub cost_30d: f64,
    pub cost_all: f64,
    pub tokens_30d: i64,
    pub sessions_30d: i64,
}

#[derive(Debug)]
pub enum OpenCodeDbError {
    Db(rusqlite::Error),
    Json(serde_json::Error),
    NotFound,
    Wsl(String),
}

impl From<rusqlite::Error> for OpenCodeDbError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Db(error)
    }
}

impl From<serde_json::Error> for OpenCodeDbError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl std::fmt::Display for OpenCodeDbError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Db(error) => write!(formatter, "OpenCode database error: {error}"),
            Self::Json(error) => write!(formatter, "OpenCode database JSON error: {error}"),
            Self::NotFound => write!(
                formatter,
                "OpenCode database not found; run OpenCode first or set OPENCODE_DB"
            ),
            Self::Wsl(error) => write!(formatter, "OpenCode WSL database error: {error}"),
        }
    }
}

impl std::error::Error for OpenCodeDbError {}

pub fn read_spend_summary_json() -> Result<String, OpenCodeDbError> {
    let path = db_path().ok_or(OpenCodeDbError::NotFound)?;
    if !path.exists() {
        return Err(OpenCodeDbError::NotFound);
    }

    if is_wsl_path(&path) {
        let summary = summarize_wsl(now_ms())?;
        return Ok(serde_json::to_string(&summary)?);
    }

    // Read-only so we never disturb a running OpenCode; SQLite readers do not
    // block writers in WAL mode.
    let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let summary = summarize(&connection, now_ms())?;
    Ok(serde_json::to_string(&summary)?)
}

fn summarize_wsl(now_ms: i64) -> Result<SpendSummary, OpenCodeDbError> {
    let cutoff_7d = now_ms - 7 * DAY_MS;
    let cutoff_30d = now_ms - 30 * DAY_MS;
    let sql = aggregate_sql(&cutoff_7d.to_string(), &cutoff_30d.to_string());

    let output = Command::new("wsl.exe")
        .args([
            "--cd",
            "~",
            "sqlite3",
            "-readonly",
            "-batch",
            "-separator",
            "\t",
            ".local/share/opencode/opencode.db",
            &sql,
        ])
        .output()
        .map_err(|error| OpenCodeDbError::Wsl(error.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(OpenCodeDbError::Wsl(if stderr.is_empty() {
            "sqlite3 failed inside WSL".to_string()
        } else {
            stderr
        }));
    }

    parse_summary_row(String::from_utf8_lossy(&output.stdout).trim())
}

/// Aggregate spend/tokens from the `session` table relative to `now_ms`. Times
/// in the table are epoch milliseconds. Split out from path/clock handling so
/// it can be tested against an in-memory database.
fn summarize(connection: &Connection, now_ms: i64) -> Result<SpendSummary, rusqlite::Error> {
    let cutoff_7d = now_ms - 7 * DAY_MS;
    let cutoff_30d = now_ms - 30 * DAY_MS;

    connection.query_row(&aggregate_sql("?1", "?2"), [cutoff_7d, cutoff_30d], |row| {
        Ok(SpendSummary {
            cost_7d: row.get(0)?,
            cost_30d: row.get(1)?,
            cost_all: row.get(2)?,
            tokens_30d: row.get(3)?,
            sessions_30d: row.get(4)?,
        })
    })
}

fn aggregate_sql(cutoff_7d: &str, cutoff_30d: &str) -> String {
    format!(
        "SELECT \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= {cutoff_7d} THEN COALESCE(cost, 0) END), 0.0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= {cutoff_30d} THEN COALESCE(cost, 0) END), 0.0), \
            COALESCE(SUM(COALESCE(cost, 0)), 0.0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= {cutoff_30d} THEN COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) END), 0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= {cutoff_30d} THEN 1 END), 0) \
         FROM session"
    )
}

fn parse_summary_row(row: &str) -> Result<SpendSummary, OpenCodeDbError> {
    let parts = row.split('\t').collect::<Vec<_>>();
    if parts.len() != 5 {
        return Err(OpenCodeDbError::Wsl(
            "sqlite3 returned an unexpected summary row".to_string(),
        ));
    }

    Ok(SpendSummary {
        cost_7d: parts[0]
            .parse()
            .map_err(|_| OpenCodeDbError::Wsl("invalid 7-day cost".to_string()))?,
        cost_30d: parts[1]
            .parse()
            .map_err(|_| OpenCodeDbError::Wsl("invalid 30-day cost".to_string()))?,
        cost_all: parts[2]
            .parse()
            .map_err(|_| OpenCodeDbError::Wsl("invalid all-time cost".to_string()))?,
        tokens_30d: parts[3]
            .parse()
            .map_err(|_| OpenCodeDbError::Wsl("invalid 30-day token total".to_string()))?,
        sessions_30d: parts[4]
            .parse()
            .map_err(|_| OpenCodeDbError::Wsl("invalid 30-day session count".to_string()))?,
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

/// Resolve the OpenCode SQLite path. Honors an `OPENCODE_DB` override, then
/// local Windows/Unix defaults, then common WSL UNC homes.
fn db_path() -> Option<PathBuf> {
    if let Some(path) = env_path("OPENCODE_DB") {
        return Some(path);
    }

    let mut candidates = Vec::new();
    if let Some(local) = env_path("LOCALAPPDATA") {
        candidates.push(local.join("opencode").join("opencode.db"));
    }
    if let Some(xdg) = env_path("XDG_DATA_HOME") {
        candidates.push(xdg.join("opencode").join("opencode.db"));
    }
    if let Some(home) = env_path("HOME").or_else(|| env_path("USERPROFILE")) {
        candidates.push(
            home.join(".local")
                .join("share")
                .join("opencode")
                .join("opencode.db"),
        );
    }
    candidates.extend(wsl_home_candidates(&[
        ".local",
        "share",
        "opencode",
        "opencode.db",
    ]));
    if let Some(path) = wsl_home_file(&[".local", "share", "opencode", "opencode.db"]) {
        candidates.push(path);
    }

    newest_existing(candidates)
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var_os(key).and_then(|value| {
        if value.is_empty() {
            None
        } else {
            Some(Path::new(&value).to_path_buf())
        }
    })
}

fn is_wsl_path(path: &Path) -> bool {
    path.to_string_lossy().starts_with(r"\\wsl")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn seed(connection: &Connection) {
        connection
            .execute_batch(
                "CREATE TABLE session (\
                    id TEXT PRIMARY KEY, \
                    time_created INTEGER, \
                    time_updated INTEGER NOT NULL, \
                    cost REAL NOT NULL DEFAULT 0, \
                    tokens_input INTEGER NOT NULL DEFAULT 0, \
                    tokens_output INTEGER NOT NULL DEFAULT 0\
                );",
            )
            .unwrap();
    }

    fn insert(connection: &Connection, id: &str, time_updated: i64, cost: f64, ti: i64, to: i64) {
        connection
            .execute(
                "INSERT INTO session (id, time_created, time_updated, cost, tokens_input, tokens_output) \
                 VALUES (?1, ?2, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, time_updated, cost, ti, to],
            )
            .unwrap();
    }

    #[test]
    fn aggregates_by_window() {
        let now = 1_000_000 * DAY_MS; // arbitrary fixed "now" in ms
        let connection = Connection::open_in_memory().unwrap();
        seed(&connection);

        insert(&connection, "today", now - 1 * DAY_MS, 1.0, 100, 50); // in 7d, 30d
        insert(&connection, "two_weeks", now - 14 * DAY_MS, 2.0, 200, 100); // in 30d only
        insert(&connection, "old", now - 90 * DAY_MS, 4.0, 999, 999); // all-time only

        let summary = summarize(&connection, now).unwrap();

        assert_eq!(summary.cost_7d, 1.0);
        assert_eq!(summary.cost_30d, 3.0);
        assert_eq!(summary.cost_all, 7.0);
        assert_eq!(summary.tokens_30d, 100 + 50 + 200 + 100);
        assert_eq!(summary.sessions_30d, 2);
    }

    #[test]
    fn empty_database_is_all_zero() {
        let connection = Connection::open_in_memory().unwrap();
        seed(&connection);
        assert_eq!(
            summarize(&connection, DAY_MS).unwrap(),
            SpendSummary::default()
        );
    }

    #[test]
    fn parses_wsl_sqlite_summary_row() {
        assert_eq!(
            parse_summary_row("1.5\t4.2\t8.08\t1500000\t12").unwrap(),
            SpendSummary {
                cost_7d: 1.5,
                cost_30d: 4.2,
                cost_all: 8.08,
                tokens_30d: 1_500_000,
                sessions_30d: 12,
            }
        );
    }
}
