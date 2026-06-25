use crate::plugin_host::ProviderSnapshot;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const SNAPSHOTS_FILE: &str = "snapshots.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SavedSnapshot {
    pub provider_id: String,
    pub captured_at: u64,
    pub snapshot: ProviderSnapshot,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
struct SnapshotFile {
    latest: Vec<SavedSnapshot>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum SnapshotDiskFormat {
    Current(SnapshotFile),
    Legacy(Vec<SavedSnapshot>),
}

#[derive(Debug)]
pub enum SnapshotStoreError {
    Io(io::Error),
    Json(serde_json::Error),
    Path(tauri::Error),
}

impl From<io::Error> for SnapshotStoreError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for SnapshotStoreError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

impl From<tauri::Error> for SnapshotStoreError {
    fn from(error: tauri::Error) -> Self {
        Self::Path(error)
    }
}

impl std::fmt::Display for SnapshotStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "snapshot storage file error: {error}"),
            Self::Json(error) => write!(formatter, "snapshot storage JSON error: {error}"),
            Self::Path(error) => write!(formatter, "snapshot storage path error: {error}"),
        }
    }
}

impl std::error::Error for SnapshotStoreError {}

pub fn save_latest(
    app: &tauri::AppHandle,
    snapshot: &ProviderSnapshot,
) -> Result<SavedSnapshot, SnapshotStoreError> {
    let mut file = load_file(app)?;
    let saved = SavedSnapshot {
        provider_id: snapshot.provider_id.clone(),
        captured_at: now_seconds(),
        snapshot: snapshot.clone(),
    };

    upsert_latest(&mut file.latest, saved.clone());

    write_file(app, &file)?;
    Ok(saved)
}

pub fn load_all(app: &tauri::AppHandle) -> Result<Vec<SavedSnapshot>, SnapshotStoreError> {
    Ok(load_file(app)?.latest)
}

fn load_file(app: &tauri::AppHandle) -> Result<SnapshotFile, SnapshotStoreError> {
    let path = snapshots_path(app)?;

    if !path.exists() {
        return Ok(SnapshotFile::default());
    }

    match serde_json::from_slice(&fs::read(path)?)? {
        SnapshotDiskFormat::Current(file) => Ok(file),
        SnapshotDiskFormat::Legacy(latest) => Ok(SnapshotFile { latest }),
    }
}

fn write_file(app: &tauri::AppHandle, file: &SnapshotFile) -> Result<(), SnapshotStoreError> {
    let path = snapshots_path(app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_vec_pretty(file)?)?;
    Ok(())
}

fn snapshots_path(app: &tauri::AppHandle) -> Result<PathBuf, SnapshotStoreError> {
    Ok(app.path().app_data_dir()?.join(SNAPSHOTS_FILE))
}

fn upsert_latest(snapshots: &mut Vec<SavedSnapshot>, saved: SavedSnapshot) {
    if let Some(existing) = snapshots
        .iter_mut()
        .find(|next| next.provider_id == saved.provider_id)
    {
        *existing = saved;
    } else {
        snapshots.push(saved);
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_host::{MetricLine, ProviderSnapshot};

    #[test]
    fn latest_snapshot_replaces_matching_provider() {
        let mut snapshots = vec![SavedSnapshot {
            provider_id: "codex".to_string(),
            captured_at: 1,
            snapshot: ProviderSnapshot {
                provider_id: "codex".to_string(),
                lines: vec![MetricLine {
                    label: "Old".to_string(),
                    value: "1".to_string(),
                }],
            },
        }];
        let saved = SavedSnapshot {
            provider_id: "codex".to_string(),
            captured_at: 2,
            snapshot: ProviderSnapshot {
                provider_id: "codex".to_string(),
                lines: vec![MetricLine {
                    label: "New".to_string(),
                    value: "2".to_string(),
                }],
            },
        };

        upsert_latest(&mut snapshots, saved);

        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].captured_at, 2);
        assert_eq!(snapshots[0].snapshot.lines[0].label, "New");
    }
}
