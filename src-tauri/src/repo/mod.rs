use crate::cmd::{self, CommandSlot};
use crate::git::{self, StatusSnapshot};
use crate::types::{repository_id, DiffResult, FileContentResult, FileSearchResult, FileTreeResult, Repository};
use crate::workspace;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub struct Repo {
    pub id: String,
    pub path: PathBuf,
    pub public: RwLock<Repository>,
    pub app: Mutex<Option<AppHandle>>,
    write: Mutex<()>,
    command: Arc<Mutex<CommandSlot>>,
    watcher_shutdown: Mutex<Option<mpsc::Sender<()>>>,
}

impl Repo {
    pub fn open(path: PathBuf) -> Result<Arc<Self>, String> {
        let id = repository_id(&path.to_string_lossy());
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        let snapshot = git::snapshot(&path)?;
        let mut public = Repository::stopped(id.clone(), path.to_string_lossy().into_owned());
        public.name = name;
        public.last_error = None;
        apply_snapshot(&mut public, snapshot);

        let repo = Arc::new(Self {
            id,
            path,
            public: RwLock::new(public),
            app: Mutex::new(None),
            write: Mutex::new(()),
            command: Arc::new(Mutex::new(CommandSlot::default())),
            watcher_shutdown: Mutex::new(None),
        });
        repo.clone().start_watcher();
        Ok(repo)
    }

    pub fn snapshot(&self) -> Repository {
        let _ = self.sync_terminal();
        self.public.read().map(|value| value.clone()).unwrap_or_else(|error| error.into_inner().clone())
    }

    pub fn refresh(&self) -> Result<Repository, String> {
        let snapshot = git::snapshot(&self.path)?;
        {
            let mut public = self.public.write().map_err(|error| error.to_string())?;
            apply_snapshot(&mut public, snapshot);
            public.last_error = None;
        }
        Ok(self.snapshot())
    }

    pub fn refresh_if_changed(&self) -> Result<bool, String> {
        if self.public.read().ok().and_then(|state| state.busy.clone()).is_some() {
            return Ok(false);
        }
        let status = git::status(&self.path)?;
        let current = self.snapshot();
        if !status_changed(&current, &status) {
            return Ok(false);
        }
        let snapshot = git::snapshot_with_status(&self.path, status)?;
        let mut public = self.public.write().map_err(|error| error.to_string())?;
        apply_snapshot(&mut public, snapshot);
        public.last_error = None;
        Ok(true)
    }

    pub fn perform(&self, operation: &str, payload: Value, app: &AppHandle) -> Result<(), String> {
        let _write = self.write.lock().map_err(|error| error.to_string())?;
        {
            let mut public = self.public.write().map_err(|error| error.to_string())?;
            public.busy = Some(operation.to_string());
            public.last_error = None;
            public.last_notice = None;
        }
        let _ = app.emit("repo-updated", self.snapshot());

        let result = execute(operation, &payload, &self.path, &self.snapshot());
        let notice = match (operation, &result) {
            ("commit", Ok(())) => Some("Committed successfully.".to_string()),
            ("commit_and_push", Ok(())) => Some("Committed and pushed successfully.".to_string()),
            _ => None,
        };
        let error = result.err();
        match git::snapshot(&self.path) {
            Ok(snapshot) => {
                let mut public = self.public.write().map_err(|e| e.to_string())?;
                apply_snapshot(&mut public, snapshot);
                public.busy = None;
                public.last_error = error.clone();
                public.last_notice = notice;
            }
            Err(snapshot_error) => {
                let mut public = self.public.write().map_err(|e| e.to_string())?;
                public.busy = None;
                public.last_error = error.or(Some(snapshot_error));
                public.last_notice = notice;
            }
        }
        let _ = app.emit("repo-updated", self.snapshot());
        if let Some(message) = self.snapshot().last_error {
            if result_was_error(&message) {
                // already stored
            }
        }
        Ok(())
    }

    pub fn run_command(&self, command: &str, app: &AppHandle) -> Result<(), String> {
        cmd::run_command(&self.command, &self.id, &self.path, command, app)?;
        self.sync_terminal()?;
        let _ = app.emit("repo-updated", self.snapshot());
        Ok(())
    }

    pub fn stop_command(&self, app: &AppHandle) -> Result<(), String> {
        cmd::stop_command(&self.command)?;
        self.sync_terminal()?;
        let _ = app.emit("repo-updated", self.snapshot());
        Ok(())
    }

    pub fn replace_port_command(&self, app: &AppHandle) -> Result<(), String> {
        cmd::replace_port_command(&self.command, &self.id, &self.path, app)?;
        self.sync_terminal()?;
        let _ = app.emit("repo-updated", self.snapshot());
        Ok(())
    }

    pub fn diff(&self, file: &str, staged: bool) -> Result<DiffResult, String> {
        let (content, truncated, binary) = git::diff(&self.path, file, staged)?;
        Ok(DiffResult {
            id: self.id.clone(),
            file: file.to_string(),
            staged,
            binary,
            truncated,
            limit: git::GitLimits::default().diff_limit,
            content,
        })
    }

    pub fn list_files(&self) -> Result<FileTreeResult, String> {
        Ok(FileTreeResult {
            id: self.id.clone(),
            files: git::files(&self.path)?,
        })
    }

    pub fn search_files(&self, query: &str) -> Result<FileSearchResult, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(FileSearchResult {
                id: self.id.clone(),
                query: String::new(),
                files: vec![],
            });
        }
        Ok(FileSearchResult {
            id: self.id.clone(),
            query: trimmed.to_string(),
            files: git::search_files(&self.path, trimmed)?,
        })
    }

    pub fn read_file(&self, file: &str) -> Result<FileContentResult, String> {
        let (path, content, size, mtime) = crate::files::read_text_file(&self.path, file)?;
        Ok(FileContentResult {
            id: self.id.clone(),
            path,
            content,
            size,
            mtime,
        })
    }

    pub fn write_file(&self, file: &str, content: &str, app: &AppHandle) -> Result<FileContentResult, String> {
        let (path, size, mtime) = crate::files::write_text_file(&self.path, file, content)?;
        let _ = self.refresh();
        let _ = app.emit("repo-updated", self.snapshot());
        Ok(FileContentResult {
            id: self.id.clone(),
            path,
            content: content.to_string(),
            size,
            mtime,
        })
    }

    pub fn create_file(&self, file: &str, app: &AppHandle) -> Result<FileContentResult, String> {
        let (path, content, size, mtime) = crate::files::create_text_file(&self.path, file)?;
        let _ = self.refresh();
        let _ = app.emit("repo-updated", self.snapshot());
        Ok(FileContentResult {
            id: self.id.clone(),
            path,
            content,
            size,
            mtime,
        })
    }

    pub fn open_external(&self, file: &str, target: Option<&str>) -> Result<(), String> {
        crate::files::open_external(&self.path, file, target)
    }

    fn sync_terminal(&self) -> Result<(), String> {
        let terminal = self
            .command
            .lock()
            .map_err(|error| error.to_string())?
            .state
            .clone();
        let mut public = self.public.write().map_err(|error| error.to_string())?;
        public.terminal = terminal;
        Ok(())
    }

    pub fn close(&self) {
        if let Ok(slot) = self.watcher_shutdown.lock() {
            if let Some(tx) = slot.as_ref() {
                let _ = tx.send(());
            }
        }
        let _ = cmd::stop_command(&self.command);
    }

    fn start_watcher(self: Arc<Self>) {
        let (tx, rx) = mpsc::channel::<()>();
        if let Ok(mut slot) = self.watcher_shutdown.lock() {
            *slot = Some(tx);
        }
        let repo = Arc::clone(&self);
        thread::spawn(move || watch_loop(repo, rx));
    }
}

impl Drop for Repo {
    fn drop(&mut self) {
        if let Ok(slot) = self.watcher_shutdown.lock() {
            if let Some(tx) = slot.as_ref() {
                let _ = tx.send(());
            }
        }
        let _ = cmd::stop_command(&self.command);
    }
}

fn watch_loop(repo: Arc<Repo>, shutdown: mpsc::Receiver<()>) {
    let (event_tx, event_rx) = mpsc::channel::<Event>();
    let mut watcher = match RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                let _ = event_tx.send(event);
            }
        },
        Config::default(),
    ) {
        Ok(watcher) => watcher,
        Err(_) => return,
    };
    if watcher.watch(&repo.path, RecursiveMode::Recursive).is_err() {
        return;
    }

    let mut last = Instant::now() - Duration::from_secs(1);
    loop {
        if shutdown.try_recv().is_ok() {
            break;
        }
        match event_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => {
                if ignored(&event) {
                    continue;
                }
                if last.elapsed() < Duration::from_millis(250) {
                    continue;
                }
                last = Instant::now();
                if repo.refresh_if_changed().ok() == Some(true) {
                    if let Ok(app) = repo.app.lock() {
                        if let Some(app) = app.as_ref() {
                            let _ = app.emit("repo-updated", repo.snapshot());
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if last.elapsed() >= Duration::from_secs(60) {
                    last = Instant::now();
                    if repo.refresh_if_changed().ok() == Some(true) {
                        if let Ok(app) = repo.app.lock() {
                            if let Some(app) = app.as_ref() {
                                let _ = app.emit("repo-updated", repo.snapshot());
                            }
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn ignored(event: &Event) -> bool {
    event.paths.iter().any(|path| {
        path.components().any(|component| {
            matches!(
                component.as_os_str().to_string_lossy().as_ref(),
                "node_modules" | "dist" | "target" | ".next" | "objects"
            )
        })
    })
}

fn status_changed(current: &Repository, status: &StatusSnapshot) -> bool {
    current.head != status.head
        || current.oid != status.oid
        || current.unborn != status.unborn
        || current.detached != status.detached
        || current.upstream != status.upstream
        || current.ahead != status.ahead
        || current.behind != status.behind
        || current.staged != status.staged
        || current.unstaged != status.unstaged
        || current.untracked != status.untracked
        || current.conflicted != status.conflicted
        || current.operation_state != status.operation_state
}

fn apply_snapshot(repo: &mut Repository, snapshot: StatusSnapshot) {
    repo.head = snapshot.head;
    repo.oid = snapshot.oid;
    repo.unborn = snapshot.unborn;
    repo.detached = snapshot.detached;
    repo.upstream = snapshot.upstream;
    repo.remote = snapshot.remote;
    repo.ahead = snapshot.ahead;
    repo.behind = snapshot.behind;
    repo.staged = snapshot.staged;
    repo.unstaged = snapshot.unstaged;
    repo.untracked = snapshot.untracked;
    repo.conflicted = snapshot.conflicted;
    repo.branches = snapshot.branches;
    repo.remotes = snapshot.remotes;
    repo.stashes = snapshot.stashes;
    repo.commits = snapshot.commits;
    repo.operation_state = snapshot.operation_state;
}

fn result_was_error(message: &str) -> bool {
    !message.is_empty()
}

fn execute(operation: &str, payload: &Value, path: &Path, summary: &Repository) -> Result<(), String> {
    match operation {
        "refresh" => Ok(()),
        "stage" => git::run_git(path, &["add", "--", required_path(payload)?]).map(|_| ()),
        "unstage" => {
            if summary.unborn {
                git::run_git(path, &["rm", "--cached", "-q", "--", required_path(payload)?])
            } else {
                git::run_git(path, &["restore", "--staged", "--", required_path(payload)?])
            }
            .map(|_| ())
        }
        "stage_all" => git::run_git(path, &["add", "-A"]).map(|_| ()),
        "unstage_all" => {
            if summary.unborn {
                git::run_git(path, &["rm", "--cached", "-r", "-q", "."])
            } else {
                git::run_git(path, &["reset", "-q", "HEAD", "--"])
            }
            .map(|_| ())
        }
        "discard" => discard(path, payload),
        "commit" => commit(path, payload, summary, false),
        "commit_and_push" => commit(path, payload, summary, true),
        "undo_last_commit" => undo_last_commit(path, payload, summary),
        "checkout_commit" => checkout_commit(path, payload),
        "fetch" => fetch(path, payload, summary),
        "pull" => pull(path, payload, summary),
        "push" => push(path, payload, summary),
        "publish_branch" => publish_branch(path, payload, summary),
        "set_upstream" => set_upstream(path, payload, summary),
        "create_branch" => create_branch(path, payload),
        "checkout_branch" => {
            let name = string_field(payload, "name")?;
            git::run_git(path, &["switch", name]).map(|_| ())
        }
        "track_branch" => {
            let remote_branch = string_field(payload, "remote_branch")?;
            let local = string_field(payload, "local")?;
            git::run_git(path, &["switch", "--track", "-c", local, remote_branch]).map(|_| ())
        }
        "rename_branch" => {
            git::run_git(
                path,
                &["branch", "-m", string_field(payload, "old")?, string_field(payload, "new")?],
            )
            .map(|_| ())
        }
        "delete_branch" => {
            confirm(payload)?;
            git::run_git(path, &["branch", "-d", string_field(payload, "name")?]).map(|_| ())
        }
        "create_stash" => create_stash(path, payload),
        "apply_stash" => git::run_git(path, &["stash", "apply", string_field(payload, "ref")?]).map(|_| ()),
        "pop_stash" => git::run_git(path, &["stash", "pop", string_field(payload, "ref")?]).map(|_| ()),
        "drop_stash" => {
            confirm(payload)?;
            git::run_git(path, &["stash", "drop", string_field(payload, "ref")?]).map(|_| ())
        }
        "continue_operation" => match summary.operation_state.as_deref() {
            Some("merge") => git::run_git(path, &["merge", "--continue"]).map(|_| ()),
            Some("rebase") => git::run_git(path, &["rebase", "--continue"]).map(|_| ()),
            _ => Err("No merge or rebase in progress".into()),
        },
        "abort_operation" => {
            confirm(payload)?;
            match summary.operation_state.as_deref() {
                Some("merge") => git::run_git(path, &["merge", "--abort"]).map(|_| ()),
                Some("rebase") => git::run_git(path, &["rebase", "--abort"]).map(|_| ()),
                _ => Err("No merge or rebase in progress".into()),
            }
        }
        other => Err(format!("Unsupported operation: {other}")),
    }
}

fn discard(path: &Path, payload: &Value) -> Result<(), String> {
    confirm(payload)?;
    let file = required_path(payload)?;
    if payload.get("untracked").and_then(Value::as_bool).unwrap_or(false) {
        git::run_git(path, &["clean", "-fd", "--", file]).map(|_| ())
    } else {
        git::run_git(path, &["restore", "--worktree", "--", file]).map(|_| ())
    }
}

fn commit(path: &Path, payload: &Value, summary: &Repository, and_push: bool) -> Result<(), String> {
    let message = string_field(payload, "message")?.trim();
    if message.is_empty() {
        return Err("Commit message is required".into());
    }
    if !summary.conflicted.is_empty() {
        return Err("Resolve conflicts before committing".into());
    }
    if summary.staged.is_empty() {
        if summary.unstaged.is_empty() && summary.untracked.is_empty() {
            return Err("There are no changes to commit".into());
        }
        git::run_git(path, &["add", "-A"])?;
    }
    git::run_git(path, &["commit", "-m", message])?;
    if and_push {
        match push(path, payload, summary) {
            Ok(()) => Ok(()),
            Err(reason) => Err(format!(
                "Commit succeeded locally, but push failed. Your commit is safe and remains on this branch.\n\n{reason}"
            )),
        }
    } else {
        Ok(())
    }
}

fn undo_last_commit(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    confirm(payload)?;
    if summary.unborn {
        return Err("There are no commits to undo".into());
    }
    if summary.detached {
        return Err("Cannot undo the last commit while HEAD is detached".into());
    }
    let output = git::run_git(path, &["rev-list", "--parents", "-n", "1", "HEAD"])?;
    let parent_count = output.split_whitespace().count().saturating_sub(1);
    if parent_count <= 1 {
        git::run_git(path, &["revert", "--no-edit", "HEAD"]).map(|_| ())
    } else {
        Err("Undoing a merge commit is not supported".into())
    }
}

fn checkout_commit(path: &Path, payload: &Value) -> Result<(), String> {
    confirm(payload)?;
    let oid = string_field(payload, "oid")?;
    if !oid.chars().all(|ch| ch.is_ascii_hexdigit()) || oid.len() < 7 || oid.len() > 40 {
        return Err("Select a valid commit".into());
    }
    let spec = format!("{oid}^{{commit}}");
    git::run_git(path, &["rev-parse", "--verify", &spec])?;
    git::run_git(path, &["switch", "--detach", oid]).map(|_| ())
}

fn fetch(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    if payload.get("all").and_then(Value::as_bool).unwrap_or(false) {
        return git::run_git(path, &["fetch", "--all", "--prune"]).map(|_| ());
    }
    let remote = payload
        .get("remote")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(summary.remote.as_deref())
        .or(summary.remotes.first().map(String::as_str));
    match remote {
        Some(remote) => git::run_git(path, &["fetch", remote, "--prune"]).map(|_| ()),
        None => Err("Select a remote to fetch".into()),
    }
}

fn pull(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    let remote = payload.get("remote").and_then(Value::as_str).filter(|value| !value.is_empty());
    let branch = payload.get("branch").and_then(Value::as_str).filter(|value| !value.is_empty());
    if let (Some(remote), Some(branch)) = (remote, branch) {
        git::run_git(path, &["pull", remote, branch]).map(|_| ())
    } else if summary.upstream.as_ref().is_some_and(|value| !value.is_empty()) {
        git::run_git(path, &["pull"]).map(|_| ())
    } else {
        Err("Select a remote and branch to pull".into())
    }
}

fn push(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    if !active_local_branch(summary) {
        return Err("Switch to a local branch before pushing".into());
    }
    let remote = payload.get("remote").and_then(Value::as_str).filter(|value| !value.is_empty());
    let branch = payload
        .get("branch")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(summary.head.as_deref());
    if payload.get("use_upstream").and_then(Value::as_bool).unwrap_or(false) && summary.upstream.is_some() {
        return git::run_git(path, &["push"]).map(|_| ());
    }
    if let (Some(remote), Some(branch)) = (remote, branch) {
        if summary.upstream.as_deref() == Some(&format!("{remote}/{branch}")) {
            git::run_git(path, &["push"]).map(|_| ())
        } else {
            git::run_git(path, &["push", "-u", remote, branch]).map(|_| ())
        }
    } else if summary.upstream.is_some() {
        git::run_git(path, &["push"]).map(|_| ())
    } else {
        Err("Select a remote to publish this branch".into())
    }
}

fn publish_branch(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    let remote = string_field(payload, "remote")?;
    if !active_local_branch(summary) {
        return Err("Select a remote and a local branch".into());
    }
    git::run_git(path, &["push", "-u", remote, summary.head.as_deref().unwrap_or("")]).map(|_| ())
}

fn set_upstream(path: &Path, payload: &Value, summary: &Repository) -> Result<(), String> {
    if !active_local_branch(summary) {
        return Err("Switch to a local branch before setting upstream".into());
    }
    let local = payload
        .get("local")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or(summary.head.as_deref())
        .ok_or_else(|| "Select a local branch and upstream".to_string())?;
    let upstream = string_field(payload, "upstream")?;
    git::run_git(path, &["branch", "--set-upstream-to", upstream, local]).map(|_| ())
}

fn create_branch(path: &Path, payload: &Value) -> Result<(), String> {
    let name = string_field(payload, "name")?;
    let start = payload.get("start").and_then(Value::as_str).filter(|value| !value.is_empty());
    match start {
        Some(start) => git::run_git(path, &["switch", "-c", name, start]).map(|_| ()),
        None => git::run_git(path, &["switch", "-c", name]).map(|_| ()),
    }
}

fn create_stash(path: &Path, payload: &Value) -> Result<(), String> {
    let mut args = vec!["stash", "push"];
    if payload.get("include_untracked").and_then(Value::as_bool).unwrap_or(false) {
        args.push("-u");
    }
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(message) = message {
        args.push("-m");
        args.push(message);
        git::run_git(path, &args).map(|_| ())
    } else {
        git::run_git(path, &args).map(|_| ())
    }
}

fn required_path(payload: &Value) -> Result<&str, String> {
    string_field(payload, "path")
}

fn string_field<'a>(payload: &'a Value, key: &str) -> Result<&'a str, String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn confirm(payload: &Value) -> Result<(), String> {
    if payload.get("confirmed").and_then(Value::as_bool).unwrap_or(false) {
        Ok(())
    } else {
        Err("This operation requires confirmation".into())
    }
}

fn active_local_branch(summary: &Repository) -> bool {
    summary
        .head
        .as_ref()
        .is_some_and(|head| !head.trim().is_empty())
        && !summary.unborn
        && !summary.detached
}

pub fn persist_paths(repos: &[Arc<Repo>], recents: &[String]) -> Result<(), String> {
    workspace::save(&workspace::StoredWorkspace {
        version: 1,
        repositories: repos
            .iter()
            .map(|repo| repo.path.to_string_lossy().into_owned())
            .collect(),
        recents: recents.to_vec(),
    })
}
