use crate::error::clean_git_error;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use wait_timeout::ChildExt;

pub const DEFAULT_DIFF_LIMIT: usize = 512 * 1024;
pub const DEFAULT_HISTORY_LIMIT: usize = 25;
pub const DEFAULT_READ_OUTPUT_LIMIT: usize = 2 * 1024 * 1024;
pub const GIT_READ_TIMEOUT: Duration = Duration::from_secs(20);
pub const GIT_WRITE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Copy)]
pub struct GitLimits {
    pub diff_limit: usize,
    pub history_limit: usize,
    pub read_output_limit: usize,
}

impl Default for GitLimits {
    fn default() -> Self {
        Self {
            diff_limit: DEFAULT_DIFF_LIMIT,
            history_limit: DEFAULT_HISTORY_LIMIT,
            read_output_limit: DEFAULT_READ_OUTPUT_LIMIT,
        }
    }
}

pub fn run(
    path: &Path,
    args: &[&str],
    timeout: Duration,
    max_output: usize,
    success_statuses: &[i32],
) -> Result<String, String> {
    let (output, _truncated) = run_limited(path, args, timeout, max_output, false, success_statuses)?;
    Ok(output)
}

pub fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
    run(
        path,
        args,
        GIT_WRITE_TIMEOUT,
        DEFAULT_READ_OUTPUT_LIMIT,
        &[0],
    )
}

pub fn run_read(path: &Path, args: &[&str]) -> Result<String, String> {
    run(
        path,
        args,
        GIT_READ_TIMEOUT,
        DEFAULT_READ_OUTPUT_LIMIT,
        &[0],
    )
}

pub fn run_limited(
    path: &Path,
    args: &[&str],
    timeout: Duration,
    max_output: usize,
    truncate: bool,
    success_statuses: &[i32],
) -> Result<(String, bool), String> {
    let git = find_git()?;
    let mut command = Command::new(&git);
    command
        .arg("-C")
        .arg(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "Never")
        .env("GIT_EDITOR", "true");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not run Git: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Git stdout is unavailable".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Git stderr is unavailable".to_string())?;

    let stdout_handle = thread::spawn(move || read_capped(&mut stdout, max_output, truncate));
    let stderr_handle = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    let status = match child
        .wait_timeout(timeout)
        .map_err(|error| format!("Could not run Git: {error}"))?
    {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Git command timed out".into());
        }
    };

    let (mut output, truncated) = stdout_handle.join().unwrap_or_else(|_| (Vec::new(), false));
    let stderr_bytes = stderr_handle.join().unwrap_or_default();
    if !stderr_bytes.is_empty() {
        if !output.is_empty() && !output.ends_with(b"\n") {
            output.push(b'\n');
        }
        if truncate && output.len() >= max_output {
            // keep stdout truncation
        } else {
            let remaining = max_output.saturating_sub(output.len());
            output.extend_from_slice(&stderr_bytes[..remaining.min(stderr_bytes.len())]);
        }
    }

    let text = String::from_utf8_lossy(&output).into_owned();
    let code = status.code().unwrap_or(1);
    if success_statuses.contains(&code) {
        Ok((text, truncated))
    } else {
        Err(clean_git_error(&text))
    }
}

fn read_capped(reader: &mut impl Read, max_output: usize, truncate: bool) -> (Vec<u8>, bool) {
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk) {
            Ok(0) => return (buf, false),
            Ok(size) => {
                if buf.len() + size > max_output {
                    let take = max_output.saturating_sub(buf.len());
                    buf.extend_from_slice(&chunk[..take]);
                    if truncate {
                        let _ = std::io::copy(&mut reader.take(u64::MAX), &mut std::io::sink());
                        return (buf, true);
                    }
                    return (buf, true);
                }
                buf.extend_from_slice(&chunk[..size]);
            }
            Err(_) => return (buf, false),
        }
    }
}

fn find_git() -> Result<PathBuf, String> {
    which("git").ok_or_else(|| "Could not find Git on PATH".to_string())
}

fn which(name: &str) -> Option<PathBuf> {
    let path_exts = if cfg!(windows) {
        std::env::var_os("PATHEXT").map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .map(|item| item.to_string())
                .collect::<Vec<_>>()
        })
    } else {
        None
    };

    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            if let Some(exts) = &path_exts {
                for ext in exts {
                    let with_ext = dir.join(format!("{name}{ext}"));
                    if with_ext.is_file() {
                        return Some(with_ext);
                    }
                }
            }
            None
        })
    })
}

pub fn canonical_root(path: &str) -> Result<PathBuf, String> {
    let expanded = dunce_expand(path)?;
    if !expanded.is_dir() {
        return Err("Directory does not exist".into());
    }
    let output = run_read(&expanded, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(output.trim()))
}

fn dunce_expand(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Directory does not exist".into());
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(|error| error.to_string())
    }
}

pub fn status(path: &Path) -> Result<crate::git::StatusSnapshot, String> {
    let output = run_read(path, &["status", "--porcelain=v2", "--branch", "-z"])?;
    let mut snapshot = crate::git::parse_status(&output);
    snapshot.operation_state = operation_state(path);
    Ok(snapshot)
}

pub fn snapshot(path: &Path) -> Result<crate::git::StatusSnapshot, String> {
    let status = status(path)?;
    snapshot_with_status(path, status)
}

pub fn snapshot_with_status(
    path: &Path,
    mut status: crate::git::StatusSnapshot,
) -> Result<crate::git::StatusSnapshot, String> {
    let limits = GitLimits::default();
    let branches_output = run_read(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let remotes_output = run_read(path, &["remote"])?;
    let stashes_output = run_read(path, &["stash", "list", "--format=%gd%x09%H%x09%gs"])?;
    status.branches = crate::git::parse_branches(&branches_output);
    status.remotes = remotes_output
        .split_terminator(|ch| ch == '\n' || ch == '\r')
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect();
    status.stashes = crate::git::parse_stashes(&stashes_output);
    status.commits = if status.unborn {
        vec![]
    } else {
        commits(path, limits.history_limit)?
    };
    Ok(status)
}

pub fn commits(path: &Path, history_limit: usize) -> Result<Vec<crate::types::Commit>, String> {
    let format = "%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%aI%x1f%s%x1e";
    let count = format!("-{history_limit}");
    let output = run_read(
        path,
        &[
            "log",
            "--all",
            "--topo-order",
            "--date-order",
            &count,
            &format!("--format={format}"),
        ],
    )?;
    Ok(crate::git::parse_commits(&output))
}

pub fn diff(path: &Path, file: &str, staged: bool) -> Result<(String, bool, bool), String> {
    let limit = DEFAULT_DIFF_LIMIT;
    let mut args = vec!["diff", "--no-ext-diff", "--no-color", "--no-textconv"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(file);
    let (output, truncated) = run_limited(
        path,
        &args,
        GIT_READ_TIMEOUT,
        limit,
        true,
        &[0],
    )?;
    let binary = output.contains("GIT binary patch") || output.contains("Binary files ");
    Ok((output, truncated, binary))
}

pub fn files(path: &Path) -> Result<Vec<String>, String> {
    let mut files = nul_paths(&run_read(
        path,
        &["ls-files", "-co", "--exclude-standard", "-z"],
    )?);
    files.extend(ignored_leaf_files(path)?);
    files.sort();
    files.dedup();
    Ok(files)
}

pub fn search_files(path: &Path, query: &str) -> Result<Vec<String>, String> {
    let output = run(
        path,
        &[
            "grep",
            "-I",
            "-l",
            "-i",
            "-F",
            "-z",
            "--no-index",
            "--exclude-standard",
            "-e",
            query,
            "--",
            ".",
        ],
        GIT_READ_TIMEOUT,
        DEFAULT_READ_OUTPUT_LIMIT,
        &[0, 1],
    )?;
    let mut files = nul_paths(&output);
    files.extend(search_paths(path, query, &ignored_leaf_files(path)?)?);
    files.sort();
    files.dedup();
    Ok(files)
}

fn ignored_leaf_files(path: &Path) -> Result<Vec<String>, String> {
    let output = run_read(
        path,
        &[
            "ls-files",
            "-o",
            "-i",
            "--exclude-standard",
            "--directory",
            "-z",
        ],
    )?;
    Ok(nul_paths(&output)
        .into_iter()
        .filter(|file| !file.ends_with('/'))
        .collect())
}

fn search_paths(path: &Path, query: &str, search_paths: &[String]) -> Result<Vec<String>, String> {
    if search_paths.is_empty() {
        return Ok(vec![]);
    }
    let mut matches = Vec::new();
    for chunk in search_paths.chunks(32) {
        let mut args = vec![
            "grep",
            "-I",
            "-l",
            "-i",
            "-F",
            "-z",
            "--no-index",
            "-e",
            query,
            "--",
        ];
        args.extend(chunk.iter().map(String::as_str));
        match run(
            path,
            &args,
            GIT_READ_TIMEOUT,
            DEFAULT_READ_OUTPUT_LIMIT,
            &[0, 1],
        ) {
            Ok(output) => matches.extend(nul_paths(&output)),
            Err(_) => continue,
        }
    }
    Ok(matches)
}

fn nul_paths(output: &str) -> Vec<String> {
    output
        .split('\0')
        .filter(|item| !item.is_empty())
        .map(|item| item.trim_start_matches("./").replace('\\', "/"))
        .collect()
}

fn operation_state(path: &Path) -> Option<String> {
    if git_path_exists(path, "rebase-merge") || git_path_exists(path, "rebase-apply") {
        Some("rebase".into())
    } else if git_path_exists(path, "MERGE_HEAD") {
        Some("merge".into())
    } else {
        None
    }
}

fn git_path_exists(path: &Path, name: &str) -> bool {
    match run_read(path, &["rev-parse", "--git-path", name]) {
        Ok(git_path) => path.join(git_path.trim()).exists(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn temp_repo() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "sunlight-git-files-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let git = find_git().unwrap();
        let status = Command::new(git)
            .args(["init"])
            .current_dir(&root)
            .status()
            .unwrap();
        assert!(status.success());
        root
    }

    #[test]
    fn lists_gitignored_dotfiles_without_ignored_directories() {
        let root = temp_repo();
        fs::write(root.join(".gitignore"), ".dev.vars\nnode_modules/\n").unwrap();
        fs::write(root.join(".dev.vars"), "SECRET=1\n").unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        fs::create_dir_all(root.join("node_modules").join("pkg")).unwrap();
        fs::write(
            root.join("node_modules").join("pkg").join("index.js"),
            "module.exports = 1;\n",
        )
        .unwrap();

        let listed = files(&root).unwrap();
        assert!(listed.contains(&"README.md".to_string()), "{listed:?}");
        assert!(listed.contains(&".gitignore".to_string()), "{listed:?}");
        assert!(listed.contains(&".dev.vars".to_string()), "{listed:?}");
        assert!(
            !listed.iter().any(|file| file.starts_with("node_modules")),
            "{listed:?}"
        );

        let matches = search_files(&root, "SECRET=1").unwrap();
        assert!(matches.contains(&".dev.vars".to_string()), "{matches:?}");
        let _ = fs::remove_dir_all(&root);
    }
}
