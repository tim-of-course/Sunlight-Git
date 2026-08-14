use crate::types::Commit;

const RECORD_SEPARATOR: char = '\u{1e}';
const FIELD_SEPARATOR: char = '\u{1f}';

pub fn parse_commits(output: &str) -> Vec<Commit> {
    if output.is_empty() {
        return vec![];
    }

    output
        .split(RECORD_SEPARATOR)
        .filter(|record| !record.trim().is_empty())
        .filter_map(parse_record)
        .collect()
}

fn parse_record(record: &str) -> Option<Commit> {
    let record = record.trim_start();
    let mut fields = record.splitn(7, FIELD_SEPARATOR);
    let oid = fields.next()?.to_string();
    let short_oid = fields.next().unwrap_or("").to_string();
    let parents = fields.next().unwrap_or("");
    let decorations = fields.next().unwrap_or("");
    let author = fields.next().unwrap_or("").to_string();
    let authored_at = fields.next().unwrap_or("").to_string();
    let subject = fields.next().unwrap_or("").to_string();
    Some(Commit {
        oid,
        short_oid,
        parent_oids: parents
            .split_whitespace()
            .map(|item| item.to_string())
            .collect(),
        refs: parse_refs(decorations),
        author,
        authored_at,
        subject,
    })
}

fn parse_refs(decorations: &str) -> Vec<String> {
    if decorations.is_empty() {
        vec![]
    } else {
        decorations
            .split(", ")
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(
        oid: &str,
        short_oid: &str,
        parents: &str,
        refs: &str,
        author: &str,
        authored_at: &str,
        subject: &str,
    ) -> String {
        [
            oid, short_oid, parents, refs, author, authored_at, subject,
        ]
        .join("\u{1f}")
            + "\u{1e}"
    }

    #[test]
    fn parses_linear_merged_and_decorated_commits() {
        let output = [
            record(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "aaaaaaa",
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc",
                "HEAD -> main, origin/main, tag: v1.0",
                "Ada Lovelace",
                "2026-06-11T10:00:00-05:00",
                "merge feature",
            ),
            record(
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "bbbbbbb",
                "",
                "",
                "Grace Hopper",
                "2026-06-10T10:00:00-05:00",
                "initial commit",
            ),
        ]
        .concat();

        let parsed = parse_commits(&output);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].short_oid, "aaaaaaa");
        assert_eq!(
            parsed[0].parent_oids,
            [
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "cccccccccccccccccccccccccccccccccccccccc"
            ]
        );
        assert_eq!(
            parsed[0].refs,
            ["HEAD -> main", "origin/main", "tag: v1.0"]
        );
        assert_eq!(parsed[0].author, "Ada Lovelace");
        assert_eq!(parsed[0].subject, "merge feature");
        assert!(parsed[1].parent_oids.is_empty());
        assert!(parsed[1].refs.is_empty());
    }

    #[test]
    fn empty_history_is_empty() {
        assert!(parse_commits("").is_empty());
    }
}
