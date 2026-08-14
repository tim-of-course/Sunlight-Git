pub type AppResult<T> = Result<T, String>;

pub fn format_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub fn clean_git_error(output: &str) -> String {
    let trimmed = output.trim();
    let message = regex::Regex::new(r"(?i)\Aerror:\s*")
        .ok()
        .and_then(|pattern| {
            let replaced = pattern.replace(trimmed, "");
            if replaced.is_empty() {
                None
            } else {
                Some(replaced.into_owned())
            }
        })
        .unwrap_or_else(|| trimmed.to_string());

    if message.is_empty() {
        "Git command failed".into()
    } else {
        message
    }
}

pub fn format_bytes(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MiB", bytes as f64 / 1024.0 / 1024.0)
    } else if bytes >= 1024 {
        format!("{:.1} KiB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} bytes")
    }
}

pub fn present(value: Option<&str>) -> bool {
    value.map(|text| !text.trim().is_empty()).unwrap_or(false)
}

pub fn present_str(value: &str) -> bool {
    !value.trim().is_empty()
}
