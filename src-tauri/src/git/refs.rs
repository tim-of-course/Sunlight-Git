use crate::types::{Branch, Stash};

pub fn parse_branches(output: &str) -> Vec<Branch> {
    output
        .split('\n')
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                return None;
            }
            let mut parts = line.split('\t');
            let full_name = parts.next().unwrap_or("").to_string();
            let name = parts.next().unwrap_or("").to_string();
            let head = parts.next().unwrap_or("").trim().to_string();
            let upstream = blank_to_none(parts.next().unwrap_or(""));
            let tracking = blank_to_none(parts.next().unwrap_or(""));
            if full_name.ends_with("/HEAD") {
                return None;
            }
            Some(Branch {
                current: head == "*",
                remote: full_name.starts_with("refs/remotes/"),
                name,
                full_name,
                upstream,
                tracking,
            })
        })
        .collect()
}

pub fn parse_stashes(output: &str) -> Vec<Stash> {
    output
        .split('\n')
        .filter_map(|line| {
            let line = line.trim_end_matches('\r');
            if line.is_empty() {
                return None;
            }
            let mut parts = line.splitn(3, '\t');
            let stash_ref = parts.next()?.to_string();
            let oid = parts.next().unwrap_or("").to_string();
            let message = parts.next().unwrap_or("").to_string();
            Some(Stash {
                stash_ref,
                oid,
                message,
            })
        })
        .collect()
}

fn blank_to_none(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_and_remote_branches_and_filters_symbolic_head() {
        let output = "refs/heads/main\tmain\t*\torigin/main\tahead 1\nrefs/remotes/origin/HEAD\torigin/HEAD\t \t\t\nrefs/remotes/origin/main\torigin/main\t \t\t\n";
        let branches = parse_branches(output);
        assert_eq!(branches.len(), 2);
        assert_eq!(branches[0].name, "main");
        assert!(branches[0].current);
        assert!(!branches[0].remote);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(branches[1].name, "origin/main");
        assert!(!branches[1].current);
        assert!(branches[1].remote);
    }

    #[test]
    fn parses_stash_records() {
        let stashes = parse_stashes("stash@{0}\tabc\tOn main: work\n");
        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].stash_ref, "stash@{0}");
        assert_eq!(stashes[0].oid, "abc");
        assert_eq!(stashes[0].message, "On main: work");
    }
}
