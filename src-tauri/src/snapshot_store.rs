use crate::plugin_host::ProviderSnapshot;
use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const SNAPSHOTS_FILE: &str = "snapshots.json";
static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

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
    let _guard = SNAPSHOT_LOCK.lock().map_err(|_| {
        SnapshotStoreError::Io(io::Error::new(
            io::ErrorKind::Other,
            "snapshot storage lock poisoned",
        ))
    })?;
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
    let _guard = SNAPSHOT_LOCK.lock().map_err(|_| {
        SnapshotStoreError::Io(io::Error::new(
            io::ErrorKind::Other,
            "snapshot storage lock poisoned",
        ))
    })?;
    Ok(load_file(app)?.latest)
}

fn load_file(app: &tauri::AppHandle) -> Result<SnapshotFile, SnapshotStoreError> {
    let path = snapshots_path(app)?;

    if !path.exists() {
        return Ok(SnapshotFile::default());
    }

    match serde_json::from_slice(&fs::read(&path)?) {
        Ok(SnapshotDiskFormat::Current(file)) => Ok(file),
        Ok(SnapshotDiskFormat::Legacy(latest)) => Ok(SnapshotFile { latest }),
        Err(error) => {
            quarantine_corrupt_file(&path)?;
            Err(error.into())
        }
    }
}

fn write_file(app: &tauri::AppHandle, file: &SnapshotFile) -> Result<(), SnapshotStoreError> {
    let path = snapshots_path(app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    write_file_atomic(&path, &serde_json::to_vec_pretty(file)?)?;
    Ok(())
}

fn write_file_atomic(path: &Path, bytes: &[u8]) -> Result<(), SnapshotStoreError> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, bytes)?;
    replace_file(&tmp_path, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> Result<(), SnapshotStoreError> {
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    fn wide(path: &Path) -> Vec<u16> {
        OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let from = wide(from);
    let to = wide(to);
    let moved = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(SnapshotStoreError::Io(io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> Result<(), SnapshotStoreError> {
    fs::rename(from, to)?;
    Ok(())
}

fn quarantine_corrupt_file(path: &PathBuf) -> Result<(), SnapshotStoreError> {
    let bad_path = path.with_extension("json.bad");
    match fs::rename(path, bad_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
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

    #[test]
    fn corrupt_snapshot_file_can_be_quarantined() {
        let dir = std::env::temp_dir().join(format!("limitlens-snapshot-test-{}", now_seconds()));
        fs::create_dir_all(&dir).expect("test dir should be created");
        let path = dir.join(SNAPSHOTS_FILE);
        fs::write(&path, b"{ broken json").expect("corrupt file should be written");

        quarantine_corrupt_file(&path).expect("corrupt file should quarantine");

        assert!(!path.exists());
        assert!(dir.join("snapshots.json.bad").exists());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_replaces_existing_snapshot_file() {
        let dir =
            std::env::temp_dir().join(format!("limitlens-snapshot-write-test-{}", now_seconds()));
        fs::create_dir_all(&dir).expect("test dir should be created");
        let path = dir.join(SNAPSHOTS_FILE);

        write_file_atomic(&path, br#"{"latest":[]}"#).expect("initial write should work");
        write_file_atomic(&path, br#"{"latest":[{"provider_id":"codex"}]}"#)
            .expect("overwrite should work");

        let contents = fs::read_to_string(&path).expect("snapshot file should be readable");
        assert!(contents.contains("codex"));
        assert!(!path.with_extension("tmp").exists());

        let _ = fs::remove_dir_all(dir);
    }
}
