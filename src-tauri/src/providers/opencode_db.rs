use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
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
        }
    }
}

impl std::error::Error for OpenCodeDbError {}

pub fn read_spend_summary_json() -> Result<String, OpenCodeDbError> {
    let path = db_path().ok_or(OpenCodeDbError::NotFound)?;
    if !path.exists() {
        return Err(OpenCodeDbError::NotFound);
    }

    // Read-only so we never disturb a running OpenCode; SQLite readers do not
    // block writers in WAL mode.
    let connection = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let summary = summarize(&connection, now_ms())?;
    Ok(serde_json::to_string(&summary)?)
}

/// Aggregate spend/tokens from the `session` table relative to `now_ms`. Times
/// in the table are epoch milliseconds. Split out from path/clock handling so
/// it can be tested against an in-memory database.
fn summarize(connection: &Connection, now_ms: i64) -> Result<SpendSummary, rusqlite::Error> {
    let cutoff_7d = now_ms - 7 * DAY_MS;
    let cutoff_30d = now_ms - 30 * DAY_MS;

    connection.query_row(
        "SELECT \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= ?1 THEN COALESCE(cost, 0) END), 0.0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= ?2 THEN COALESCE(cost, 0) END), 0.0), \
            COALESCE(SUM(COALESCE(cost, 0)), 0.0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= ?2 THEN COALESCE(tokens_input, 0) + COALESCE(tokens_output, 0) END), 0), \
            COALESCE(SUM(CASE WHEN COALESCE(time_updated, time_created) >= ?2 THEN 1 END), 0) \
         FROM session",
        [cutoff_7d, cutoff_30d],
        |row| {
            Ok(SpendSummary {
                cost_7d: row.get(0)?,
                cost_30d: row.get(1)?,
                cost_all: row.get(2)?,
                tokens_30d: row.get(3)?,
                sessions_30d: row.get(4)?,
            })
        },
    )
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

    candidates.into_iter().find(|path| path.exists())
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
}
