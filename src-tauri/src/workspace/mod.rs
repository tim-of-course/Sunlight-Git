use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredWorkspace {
    pub version: u32,
    pub repositories: Vec<String>,
    pub recents: Vec<String>,
}

impl Default for StoredWorkspace {
    fn default() -> Self {
        Self {
            version: VERSION,
            repositories: vec![],
            recents: vec![],
        }
    }
}

pub fn path() -> PathBuf {
    if let Ok(path) = std::env::var("SUNLIGHT_WORKSPACE_FILE") {
        return PathBuf::from(path);
    }

    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from))
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("Library")
                    .join("Application Support")
            } else {
                dirs::home_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".config")
            }
        });

    base.join("Sunlight").join("workspace.json")
}

pub fn load() -> StoredWorkspace {
    let target = path();
    load_file(&target)
        .or_else(|| load_file(&backup_path(&target)))
        .unwrap_or_default()
}

pub fn save(data: &StoredWorkspace) -> Result<(), String> {
    let target = path();
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let normalized = normalize(data);
    let encoded = serde_json::to_string_pretty(&normalized).map_err(|error| error.to_string())?;
    let temp = temp_path(&target);
    fs::write(&temp, encoded).map_err(|error| error.to_string())?;
    replace(&temp, &target)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn load_file(file: &Path) -> Option<StoredWorkspace> {
    let body = fs::read_to_string(file).ok()?;
    let data: serde_json::Value = serde_json::from_str(&body).ok()?;
    let repositories = data.get("repositories")?.as_array()?;
    let recents = data.get("recents")?.as_array()?;
    if !repositories.iter().all(|item| item.is_string()) || !recents.iter().all(|item| item.is_string()) {
        return None;
    }
    Some(normalize(&StoredWorkspace {
        version: VERSION,
        repositories: repositories
            .iter()
            .filter_map(|item| item.as_str().map(|value| value.to_string()))
            .collect(),
        recents: recents
            .iter()
            .filter_map(|item| item.as_str().map(|value| value.to_string()))
            .collect(),
    }))
}

fn normalize(data: &StoredWorkspace) -> StoredWorkspace {
    StoredWorkspace {
        version: VERSION,
        repositories: normalize_paths(&data.repositories),
        recents: normalize_paths(&data.recents).into_iter().take(20).collect(),
    }
}

fn normalize_paths(paths: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        let key = trimmed.to_lowercase();
        if seen.insert(key) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn replace(temp: &Path, target: &Path) -> Result<(), String> {
    let backup = backup_path(target);
    if target.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(target, &backup).map_err(|error| error.to_string())?;
        if let Err(error) = fs::rename(temp, target) {
            let _ = fs::rename(&backup, target);
            return Err(error.to_string());
        }
        Ok(())
    } else {
        fs::rename(temp, target).map_err(|error| error.to_string())
    }
}

fn backup_path(target: &Path) -> PathBuf {
    PathBuf::from(format!("{}.backup", target.display()))
}

fn temp_path(target: &Path) -> PathBuf {
    PathBuf::from(format!("{}.tmp", target.display()))
}

pub fn put_recent(recents: &[String], path: &str) -> Vec<String> {
    let mut next = vec![path.to_string()];
    for item in recents {
        if item.to_lowercase() != path.to_lowercase() {
            next.push(item.clone());
        }
    }
    next.truncate(20);
    next
}
