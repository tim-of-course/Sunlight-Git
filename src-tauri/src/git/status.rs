use crate::types::{Branch, Commit, GitFile, Stash};

#[derive(Debug, Clone, PartialEq)]
pub struct StatusSnapshot {
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
}

impl Default for StatusSnapshot {
    fn default() -> Self {
        Self {
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
        }
    }
}

pub fn parse_status(output: &str) -> StatusSnapshot {
    let tokens: Vec<&str> = output.split('\0').filter(|token| !token.is_empty()).collect();
    let mut state = StatusSnapshot::default();
    let mut index = 0;

    while index < tokens.len() {
        let token = tokens[index];
        if let Some(record) = token.strip_prefix("2 ") {
            let original = tokens.get(index + 1).copied().unwrap_or("");
            add_file(&mut state, parse_changed(record, true, Some(original)));
            index += 2;
            continue;
        }

        if token.starts_with("# ") {
            parse_headers(token, &mut state);
            index += 1;
            continue;
        }

        if let Some(record) = token.strip_prefix("1 ") {
            add_file(&mut state, parse_changed(record, false, None));
        } else if let Some(record) = token.strip_prefix("u ") {
            add_file(&mut state, parse_unmerged(record));
        } else if let Some(path) = token.strip_prefix("? ") {
            add_file(
                &mut state,
                GitFile {
                    path: path.to_string(),
                    original_path: None,
                    kind: "untracked".into(),
                    index_status: None,
                    worktree_status: None,
                },
            );
        }

        index += 1;
    }

    sort_files(&mut state);
    state
}

fn parse_headers(token: &str, state: &mut StatusSnapshot) {
    for header in token.split('\n').filter(|line| !line.is_empty()) {
        if header == "# branch.oid (initial)" {
            state.oid = None;
            state.unborn = true;
        } else if let Some(oid) = header.strip_prefix("# branch.oid ") {
            state.oid = Some(oid.to_string());
        } else if header == "# branch.head (detached)" {
            state.head = Some("Detached HEAD".into());
            state.detached = true;
        } else if let Some(head) = header.strip_prefix("# branch.head ") {
            state.head = Some(head.to_string());
        } else if let Some(upstream) = header.strip_prefix("# branch.upstream ") {
            state.upstream = Some(upstream.to_string());
            state.remote = upstream.split('/').next().map(|part| part.to_string());
        } else if let Some(counts) = header.strip_prefix("# branch.ab +") {
            if let Some((ahead, behind)) = counts.split_once(" -") {
                state.ahead = ahead.parse().unwrap_or(0);
                state.behind = behind.parse().unwrap_or(0);
            }
        }
    }
}

fn parse_changed(record: &str, renamed: bool, original: Option<&str>) -> GitFile {
    let field_count = if renamed { 9 } else { 8 };
    let fields: Vec<&str> = record.splitn(field_count, ' ').collect();
    let xy = fields.first().copied().unwrap_or("..");
    GitFile {
        path: fields.last().copied().unwrap_or("").to_string(),
        original_path: original
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty()),
        index_status: xy.chars().next().map(|ch| ch.to_string()),
        worktree_status: xy.chars().nth(1).map(|ch| ch.to_string()),
        kind: kind(xy),
    }
}

fn parse_unmerged(record: &str) -> GitFile {
    let fields: Vec<&str> = record.splitn(11, ' ').collect();
    GitFile {
        path: fields.last().copied().unwrap_or("").to_string(),
        original_path: None,
        kind: "conflicted".into(),
        index_status: Some("U".into()),
        worktree_status: Some("U".into()),
    }
}

fn add_file(state: &mut StatusSnapshot, file: GitFile) {
    match file.kind.as_str() {
        "untracked" => state.untracked.push(file),
        "conflicted" => state.conflicted.push(file),
        _ => {
            if file.index_status.as_deref() != Some(".") {
                state.staged.push(file.clone());
            }
            if file.worktree_status.as_deref() != Some(".") {
                state.unstaged.push(file);
            }
        }
    }
}

fn kind(xy: &str) -> String {
    if xy.contains('R') {
        "renamed".into()
    } else if xy.contains('D') {
        "deleted".into()
    } else if xy.contains('A') {
        "added".into()
    } else if xy.contains('T') {
        "type_changed".into()
    } else {
        "modified".into()
    }
}

fn sort_files(state: &mut StatusSnapshot) {
    let by_path = |left: &GitFile, right: &GitFile| left.path.to_lowercase().cmp(&right.path.to_lowercase());
    state.staged.sort_by(by_path);
    state.unstaged.sort_by(by_path);
    state.untracked.sort_by(by_path);
    state.conflicted.sort_by(by_path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_metadata_and_working_tree_groups() {
        let output = [
            "# branch.oid abc123",
            "\0",
            "# branch.head main",
            "\0",
            "# branch.upstream origin/main",
            "\0",
            "# branch.ab +2 -1",
            "\0",
            "1 M. N... 100644 100644 100644 abc123 def456 staged.txt",
            "\0",
            "1 .M N... 100644 100644 100644 abc123 abc123 changed.txt",
            "\0",
            "? new.txt",
            "\0",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflict.txt",
            "\0",
        ]
        .concat();

        let result = parse_status(&output);
        assert_eq!(result.head.as_deref(), Some("main"));
        assert_eq!(result.upstream.as_deref(), Some("origin/main"));
        assert_eq!(result.remote.as_deref(), Some("origin"));
        assert_eq!(result.ahead, 2);
        assert_eq!(result.behind, 1);
        assert_eq!(
            result.staged.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            ["staged.txt"]
        );
        assert_eq!(
            result.unstaged.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            ["changed.txt"]
        );
        assert_eq!(
            result.untracked.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            ["new.txt"]
        );
        assert_eq!(
            result.conflicted.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            ["conflict.txt"]
        );
    }

    #[test]
    fn parses_unborn_and_detached_heads() {
        let unborn = parse_status("# branch.oid (initial)\0# branch.head main\0");
        let detached = parse_status("# branch.oid abc\0# branch.head (detached)\0");
        assert!(unborn.unborn);
        assert_eq!(unborn.head.as_deref(), Some("main"));
        assert!(detached.detached);
        assert_eq!(detached.head.as_deref(), Some("Detached HEAD"));
    }

    #[test]
    fn parses_rename_records_with_original_path() {
        let output = "2 R. N... 100644 100644 100644 abc def R100 renamed.txt\0original.txt\0";
        let staged = parse_status(output).staged;
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].path, "renamed.txt");
        assert_eq!(staged[0].original_path.as_deref(), Some("original.txt"));
        assert_eq!(staged[0].kind, "renamed");
    }
}
