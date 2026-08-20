use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Branch {
    pub name: String,
    pub full_name: String,
    pub current: bool,
    pub remote: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Stash {
    #[serde(rename = "ref")]
    pub stash_ref: String,
    pub oid: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Commit {
    pub oid: String,
    pub short_oid: String,
    pub parent_oids: Vec<String>,
    pub subject: String,
    pub author: String,
    pub authored_at: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PortConflict {
    pub port: u16,
    pub pid: u32,
    pub process_name: Option<String>,
    pub replaceable: bool,
    pub command: String,
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalState {
    pub running: bool,
    pub command: Option<String>,
    pub output: String,
    pub exit_status: Option<i32>,
    pub port_conflict: Option<PortConflict>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            running: false,
            command: None,
            output: String::new(),
            exit_status: None,
            port_conflict: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: String,
    pub head: Option<String>,
    pub oid: Option<String>,
    pub unborn: bool,
    pub detached: bool,
    pub upstream: Option<String>,
    pub remote: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub staged: Vec<GitFile>,
    pub unstaged: Vec<GitFile>,
    pub untracked: Vec<GitFile>,
    pub conflicted: Vec<GitFile>,
    pub branches: Vec<Branch>,
    pub remotes: Vec<String>,
    pub stashes: Vec<Stash>,
    pub commits: Vec<Commit>,
    pub operation_state: Option<String>,
    pub busy: Option<String>,
    pub last_error: Option<String>,
    pub last_notice: Option<String>,
    pub terminal: TerminalState,
}

impl Repository {
    pub fn stopped(id: String, path: String) -> Self {
        Self {
            name: std::path::Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone()),
            id,
            path,
            head: None,
            oid: None,
            unborn: false,
            detached: false,
            upstream: None,
            remote: None,
            ahead: 0,
            behind: 0,
            staged: vec![],
            unstaged: vec![],
            untracked: vec![],
            conflicted: vec![],
            branches: vec![],
            remotes: vec![],
            stashes: vec![],
            commits: vec![],
            operation_state: None,
            busy: None,
            last_error: Some("Repository process stopped".into()),
            last_notice: None,
            terminal: TerminalState::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceState {
    pub repositories: Vec<Repository>,
    pub recents: Vec<String>,
    pub workspace_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub id: String,
    pub file: String,
    pub staged: bool,
    pub binary: bool,
    pub truncated: bool,
    pub limit: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeResult {
    pub id: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSearchResult {
    pub id: String,
    pub query: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileContentResult {
    pub id: String,
    pub path: String,
    pub content: String,
    pub size: u64,
    pub mtime: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandChunk {
    pub id: String,
    pub data: String,
}

pub fn repository_id(path: &str) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let identity = if cfg!(windows) || cfg!(target_os = "macos") {
        path.to_lowercase()
    } else {
        path.to_string()
    };
    let digest = Sha256::digest(identity.as_bytes());
    let encoded = URL_SAFE_NO_PAD.encode(digest);
    encoded.chars().take(16).collect()
}
