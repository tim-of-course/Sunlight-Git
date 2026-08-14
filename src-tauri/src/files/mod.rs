use crate::error::format_bytes;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const FILE_READ_LIMIT: u64 = 1024 * 1024;

pub struct SafeFile {
    pub full_path: PathBuf,
    pub relative: String,
}

pub fn safe_relative_path(root: &Path, file: &str) -> Result<SafeFile, String> {
    let trimmed = file.trim();
    if trimmed.is_empty() {
        return Err("File path is required".into());
    }
    if trimmed.contains('\0') {
        return Err("File path is invalid".into());
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err("File path must be relative".into());
    }

    let root = normalize_path(root);
    let full_path = normalize_path(&root.join(trimmed));
    if !inside_root(&root, &full_path) {
        return Err("File path escapes repository".into());
    }
    reject_symlink_path(&root, &full_path)?;
    let relative = full_path
        .strip_prefix(&root)
        .map_err(|_| "File path escapes repository".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(SafeFile {
        full_path,
        relative,
    })
}

pub fn read_text_file(root: &Path, file: &str) -> Result<(String, String, u64, Option<String>), String> {
    let safe = safe_relative_path(root, file)?;
    if !safe.full_path.is_file() {
        return Err("File does not exist".into());
    }
    let metadata = fs::metadata(&safe.full_path).map_err(map_io)?;
    if metadata.len() > FILE_READ_LIMIT {
        return Err(format!(
            "File is larger than {}",
            format_bytes(FILE_READ_LIMIT as usize)
        ));
    }
    let bytes = fs::read(&safe.full_path).map_err(map_io)?;
    let content = String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8 text".to_string())?;
    text_content(&content)?;
    Ok((
        safe.relative,
        content,
        metadata.len(),
        file_mtime_iso(metadata.modified().ok()),
    ))
}

pub fn write_text_file(
    root: &Path,
    file: &str,
    content: &str,
) -> Result<(String, u64, Option<String>), String> {
    let safe = safe_relative_path(root, file)?;
    if !safe.full_path.is_file() {
        return Err("File does not exist".into());
    }
    text_content(content)?;
    fs::write(&safe.full_path, content).map_err(map_io)?;
    let metadata = fs::metadata(&safe.full_path).map_err(map_io)?;
    Ok((
        safe.relative,
        metadata.len(),
        file_mtime_iso(metadata.modified().ok()),
    ))
}

pub fn open_external(root: &Path, file: &str, target: Option<&str>) -> Result<(), String> {
    let safe = safe_relative_path(root, file)?;
    if !safe.full_path.is_file() {
        return Err("File does not exist".into());
    }
    match target.unwrap_or("os") {
        "cursor" => run_open("cursor", &[safe.full_path.as_os_str()]),
        "vscode" => run_open("code", &[safe.full_path.as_os_str()]),
        _ => os_open(&safe.full_path),
    }
}

fn run_open(command: &str, args: &[&std::ffi::OsStr]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(command);
    cmd.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    match cmd.status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!(
            "Could not open file with {command} (exit {})",
            status.code().unwrap_or(1)
        )),
        Err(error) => Err(error.to_string()),
    }
}

fn os_open(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        run_open(
            "cmd.exe",
            &[
                std::ffi::OsStr::new("/c"),
                std::ffi::OsStr::new("start"),
                std::ffi::OsStr::new(""),
                path.as_os_str(),
            ],
        )
    }
    #[cfg(target_os = "macos")]
    {
        run_open("open", &[path.as_os_str()])
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        run_open("xdg-open", &[path.as_os_str()])
    }
}

fn text_content(content: &str) -> Result<(), String> {
    if content.contains('\0') {
        Err("Binary files cannot be edited".into())
    } else {
        Ok(())
    }
}

fn inside_root(root: &Path, path: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn reject_symlink_path(root: &Path, full_path: &Path) -> Result<(), String> {
    let relative = full_path.strip_prefix(root).unwrap_or(full_path);
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        if is_link(&current) {
            return Err("Symbolic links cannot be opened or edited".into());
        }
    }
    Ok(())
}

fn is_link(path: &Path) -> bool {
    let Ok(metadata) = path.symlink_metadata() else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn file_mtime_iso(modified: Option<SystemTime>) -> Option<String> {
    modified.and_then(|time| {
        time.duration_since(SystemTime::UNIX_EPOCH)
            .ok()
            .map(|duration| simple_iso(duration.as_secs() as i64))
    })
}

fn simple_iso(secs: i64) -> String {
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    let (year, month, day) = civil_from_days(days + 719468);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

fn map_io(error: std::io::Error) -> String {
    error.to_string()
}
