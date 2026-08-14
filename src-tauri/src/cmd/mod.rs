use crate::types::{CommandChunk, PortConflict, TerminalState};
use regex::Regex;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TERMINAL_OUTPUT_LIMIT: usize = 32 * 1024;

#[derive(Default)]
pub struct CommandSlot {
    pub state: TerminalState,
    child: Option<TrackedChild>,
}

struct TrackedChild {
    child: Child,
    os_pid: Option<u32>,
    #[cfg(windows)]
    _job: Option<windows_job::Job>,
}

pub fn run_command(
    slot: &Arc<Mutex<CommandSlot>>,
    repo_id: &str,
    path: &Path,
    command: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let mut guard = slot.lock().map_err(|error| error.to_string())?;
    if guard.state.running {
        return Err("Command is already running".into());
    }

    let prepared = prepare_terminal_command(path, command)?;
    if let Some(port) = prepared.port {
        if let Some(listener) = listener_on_port(port) {
            let conflict = port_conflict(&prepared, &listener);
            guard.state = port_conflict_terminal(&prepared, conflict);
            return Ok(());
        }
    }

    let mut child = spawn_command(path, &prepared.command)?;
    let os_pid = child.id();
    let stdout = child.stdout.take();
    #[cfg(windows)]
    let job = windows_job::assign(os_pid).ok();

    guard.state = TerminalState {
        running: true,
        command: Some(prepared.original_command.clone()),
        output: format!("$ {}\n", prepared.original_command),
        exit_status: None,
        port_conflict: None,
    };
    guard.child = Some(TrackedChild {
        child,
        os_pid: Some(os_pid),
        #[cfg(windows)]
        _job: job,
    });
    drop(guard);

    if let Some(stdout) = stdout {
        let slot = Arc::clone(slot);
        let app = app.clone();
        let repo_id = repo_id.to_string();
        let path = path.to_path_buf();
        let original = prepared.original_command.clone();
        thread::spawn(move || pump_output(slot, app, repo_id, path, original, stdout));
    }

    Ok(())
}

pub fn stop_command(slot: &Arc<Mutex<CommandSlot>>) -> Result<(), String> {
    let mut guard = slot.lock().map_err(|error| error.to_string())?;
    if !guard.state.running {
        return Ok(());
    }
    if let Some(tracked) = guard.child.as_mut() {
        kill_tree(tracked);
        let _ = tracked.child.kill();
        let _ = tracked.child.wait();
    }
    guard.child = None;
    guard.state.running = false;
    guard.state.output = append_output(&guard.state.output, "\n[stopped]\n");
    guard.state.exit_status = None;
    guard.state.port_conflict = None;
    Ok(())
}

pub fn replace_port_command(
    slot: &Arc<Mutex<CommandSlot>>,
    repo_id: &str,
    path: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    let command = {
        let guard = slot.lock().map_err(|error| error.to_string())?;
        if guard.state.running {
            return Err("Command is already running".into());
        }
        let conflict = guard
            .state
            .port_conflict
            .as_ref()
            .ok_or_else(|| "No replaceable port conflict".to_string())?;
        if !conflict.replaceable {
            return Err("Port conflict is not replaceable".into());
        }
        replace_conflicting_listener(conflict)?;
        conflict.command.clone()
    };
    run_command(slot, repo_id, path, &command, app)
}

fn pump_output(
    slot: Arc<Mutex<CommandSlot>>,
    app: AppHandle,
    repo_id: String,
    path: PathBuf,
    command: String,
    stdout: impl std::io::Read + Send + 'static,
) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        match line {
            Ok(text) => {
                let chunk = format!("{text}\n");
                if let Ok(mut guard) = slot.lock() {
                    guard.state.output = append_output(&guard.state.output, &chunk);
                }
                let _ = app.emit(
                    "cmd-chunk",
                    CommandChunk {
                        id: repo_id.clone(),
                        data: chunk,
                    },
                );
            }
            Err(_) => break,
        }
    }

    let (status, port_conflict) = {
        let mut guard = match slot.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let status = guard
            .child
            .as_mut()
            .and_then(|tracked| tracked.child.wait().ok())
            .and_then(|status| status.code());
        guard.child = None;
        guard.state.running = false;
        guard.state.exit_status = status;
        let output = append_output(
            &guard.state.output,
            &format!("\n[exit {}]\n", status.unwrap_or(1)),
        );
        guard.state.output = output.clone();
        let port_conflict = if status.unwrap_or(1) != 0 {
            exit_port_conflict(&path, &command, &output, status.unwrap_or(1))
        } else {
            None
        };
        guard.state.port_conflict = port_conflict.clone();
        (status, port_conflict)
    };

    let _ = app.emit(
        "cmd-exited",
        serde_json::json!({
            "id": repo_id,
            "exit_status": status,
            "port_conflict": port_conflict
        }),
    );
}

fn spawn_command(path: &Path, command: &str) -> Result<Child, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "cd /d {} && set GIT_TERMINAL_PROMPT=0 && set NO_COLOR=1 && set TERM=xterm-256color && {} 2>&1",
            cmd_quote(path),
            command
        );
        Command::new("cmd.exe")
            .args(["/d", "/c", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        let script = format!(
            "export GIT_TERMINAL_PROMPT=0 NO_COLOR=1 TERM=xterm-256color\ncd {}\n{} 2>&1\n",
            shell_quote(&path.to_string_lossy()),
            command
        );
        Command::new("sh")
            .args(["-lc", &script])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|error| error.to_string())
    }
}

fn cmd_quote(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('/', "\\").replace('"', "\"\"");
    format!("\"{normalized}\"")
}

#[cfg(not(windows))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn append_output(output: &str, data: &str) -> String {
    let combined = format!("{output}{data}");
    if combined.len() <= TERMINAL_OUTPUT_LIMIT {
        return combined;
    }
    let start = combined.len() - TERMINAL_OUTPUT_LIMIT;
    let start = combined
        .char_indices()
        .find(|(index, _)| *index >= start)
        .map(|(index, _)| index)
        .unwrap_or(0);
    combined[start..].to_string()
}

struct PreparedCommand {
    original_command: String,
    command: String,
    port: Option<u16>,
    family: Option<&'static str>,
}

struct Listener {
    pid: u32,
    process_name: String,
}

fn prepare_terminal_command(path: &Path, raw: &str) -> Result<PreparedCommand, String> {
    let command = raw.trim();
    if command.is_empty() {
        return Err("Command is required".into());
    }
    let words = split_words(command);
    let script = package_script(path, &words);
    let script_words = script.as_deref().map(split_words).unwrap_or_default();
    let port = port_from_words(&words).or_else(|| port_from_words(&script_words));
    let family = command_family(&words, &script_words);
    let command_line = maybe_force_strict_port(command, &words, &script_words);
    Ok(PreparedCommand {
        original_command: command.to_string(),
        command: command_line,
        port,
        family,
    })
}

fn split_words(command: &str) -> Vec<String> {
    command.split_whitespace().map(|item| item.to_string()).collect()
}

fn package_script(path: &Path, words: &[String]) -> Option<String> {
    let script_name = package_script_name(words)?;
    let content = fs_read(path.join("package.json"))?;
    let package: serde_json::Value = serde_json::from_str(&content).ok()?;
    package
        .get("scripts")?
        .get(script_name)?
        .as_str()
        .map(|value| value.to_string())
}

fn package_script_name(words: &[String]) -> Option<&str> {
    let tool = command_name(words.first()?);
    if words.len() >= 3 && ["bun", "npm", "pnpm", "yarn"].contains(&tool.as_str()) && words[1] == "run" {
        return Some(words[2].as_str());
    }
    if words.len() >= 2 && ["bun", "pnpm", "yarn"].contains(&tool.as_str()) && !words[1].starts_with('-') {
        return Some(words[1].as_str());
    }
    None
}

fn command_name(command: &str) -> String {
    Path::new(command)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| command.to_string())
        .to_lowercase()
        .trim_end_matches(".cmd")
        .trim_end_matches(".exe")
        .trim_end_matches(".bat")
        .trim_end_matches(".ps1")
        .to_string()
}

fn command_family(words: &[String], script_words: &[String]) -> Option<&'static str> {
    if vite_server_command(words, script_words) {
        return Some("node");
    }
    let first = command_name(words.first()?);
    if ["node", "bun", "npm", "pnpm", "yarn", "npx", "bunx"].contains(&first.as_str()) {
        Some("node")
    } else {
        None
    }
}

fn maybe_force_strict_port(command: &str, words: &[String], script_words: &[String]) -> String {
    if !vite_server_command(words, script_words) {
        return command.to_string();
    }
    if strict_port(words) || strict_port(script_words) {
        return command.to_string();
    }
    if package_script_name(words).is_some() {
        if words.iter().any(|word| word == "--") || command_name(words.first().unwrap_or(&String::new())) == "yarn" {
            format!("{command} --strictPort")
        } else {
            format!("{command} -- --strictPort")
        }
    } else {
        format!("{command} --strictPort")
    }
}

fn vite_server_command(words: &[String], script_words: &[String]) -> bool {
    direct_vite(words) || vite_in(script_words)
}

fn direct_vite(words: &[String]) -> bool {
    if words.is_empty() {
        return false;
    }
    match command_name(&words[0]).as_str() {
        "vite" => vite_invocation_server(&words[1..]),
        "npx" | "bunx" => {
            words.get(1).map(|word| command_name(word) == "vite").unwrap_or(false)
                && vite_invocation_server(&words.get(2..).unwrap_or(&[]))
        }
        _ => false,
    }
}

fn vite_in(words: &[String]) -> bool {
    words.iter().enumerate().any(|(index, word)| {
        command_name(word) == "vite" && vite_invocation_server(&words[index + 1..])
    })
}

fn vite_invocation_server(args: &[String]) -> bool {
    let invocation: Vec<_> = args
        .iter()
        .take_while(|word| !matches!(word.as_str(), "&&" | "||" | ";"))
        .cloned()
        .collect();
    if invocation.iter().any(|word| matches!(command_name(word).as_str(), "dev" | "serve" | "preview")) {
        true
    } else {
        !invocation.iter().any(|word| matches!(command_name(word).as_str(), "build" | "optimize"))
    }
}

fn strict_port(words: &[String]) -> bool {
    words
        .iter()
        .any(|word| word == "--strictPort" || word.starts_with("--strictPort="))
}

fn port_from_words(words: &[String]) -> Option<u16> {
    let mut found = None;
    let mut index = 0;
    while index < words.len() {
        match words[index].as_str() {
            "--port" | "-p" => {
                if let Some(value) = words.get(index + 1) {
                    found = parse_port(value);
                    index += 2;
                    continue;
                }
            }
            other if other.starts_with("--port=") => {
                found = parse_port(&other[7..]);
            }
            _ => {}
        }
        index += 1;
    }
    found
}

fn parse_port(value: &str) -> Option<u16> {
    value.parse::<u16>().ok().filter(|port| *port > 0)
}

fn listener_on_port(port: u16) -> Option<Listener> {
    #[cfg(windows)]
    {
        windows_listener(port)
    }
    #[cfg(not(windows))]
    {
        unix_listener(port)
    }
}

#[cfg(windows)]
fn windows_listener(port: u16) -> Option<Listener> {
    let script = format!(
        "$connection = Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -ne $connection) {{
  $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
  $name = if ($null -ne $process) {{ $process.ProcessName }} else {{ \"\" }}
  Write-Output \"$($connection.OwningProcess)`t$name\"
}}"
    );
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if line.is_empty() {
        return None;
    }
    let mut parts = line.split('\t');
    let pid = parts.next()?.trim().parse().ok()?;
    let process_name = parts.next().unwrap_or("").trim().to_string();
    Some(Listener { pid, process_name })
}

#[cfg(not(windows))]
fn unix_listener(port: u16) -> Option<Listener> {
    let output = Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-Fpc"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut pid = None;
    let mut name = String::new();
    for line in text.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().ok();
        } else if let Some(value) = line.strip_prefix('c') {
            name = value.to_string();
        }
    }
    Some(Listener {
        pid: pid?,
        process_name: name,
    })
}

fn port_conflict(prepared: &PreparedCommand, listener: &Listener) -> PortConflict {
    let listener_family = listener_family(listener);
    PortConflict {
        port: prepared.port.unwrap_or(0),
        pid: listener.pid,
        process_name: Some(listener.process_name.clone()).filter(|name| !name.is_empty()),
        replaceable: prepared.family == Some("node") && listener_family == Some("node"),
        command: prepared.original_command.clone(),
        family: listener_family.map(|value| value.to_string()),
    }
}

fn port_conflict_terminal(prepared: &PreparedCommand, conflict: PortConflict) -> TerminalState {
    let process = conflict
        .process_name
        .clone()
        .unwrap_or_else(|| "process".into());
    let action = if conflict.replaceable {
        format!("Use Replace Port to kill that {process} process and restart.")
    } else {
        "Replace Port is unavailable because the listener is not a matching dev-server process.".into()
    };
    TerminalState {
        running: false,
        command: Some(prepared.original_command.clone()),
        output: format!(
            "$ {}\nPort {} is in use by {process} (PID {}).\n{action}\n",
            prepared.original_command, conflict.port, conflict.pid
        ),
        exit_status: Some(1),
        port_conflict: Some(conflict),
    }
}

fn listener_family(listener: &Listener) -> Option<&'static str> {
    match command_name(&listener.process_name).as_str() {
        "node" | "bun" => Some("node"),
        _ => None,
    }
}

fn exit_port_conflict(path: &Path, command: &str, output: &str, status: i32) -> Option<PortConflict> {
    if status == 0 {
        return None;
    }
    let regex = Regex::new(r"(?i)Port\s+(\d+)\s+is already in use").ok()?;
    let port = regex
        .captures(output)
        .and_then(|caps| caps.get(1)?.as_str().parse().ok())?;
    let mut prepared = prepare_terminal_command(path, command).ok()?;
    prepared.port = Some(port);
    let listener = listener_on_port(port)?;
    Some(port_conflict(&prepared, &listener))
}

fn replace_conflicting_listener(conflict: &PortConflict) -> Result<(), String> {
    let listener = listener_on_port(conflict.port)
        .ok_or_else(|| format!("Port {} is no longer in use", conflict.port))?;
    if listener.pid != conflict.pid {
        return Err(format!(
            "Port {} is now used by {} (PID {}); run again to refresh the conflict",
            conflict.port,
            if listener.process_name.is_empty() {
                "process"
            } else {
                &listener.process_name
            },
            listener.pid
        ));
    }
    if conflict.replaceable && listener_family(&listener) == Some("node") {
        kill_pid(listener.pid)?;
        wait_for_port_release(conflict.port)
    } else {
        Err(format!(
            "Port {} is now used by {}, not a matching dev-server process",
            conflict.port, listener.process_name
        ))
    }
}

fn wait_for_port_release(port: u16) -> Result<(), String> {
    for _ in 0..30 {
        if listener_on_port(port).is_none() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(100));
    }
    if let Some(listener) = listener_on_port(port) {
        Err(format!(
            "Port {port} is still used by {} (PID {})",
            listener.process_name, listener.pid
        ))
    } else {
        Ok(())
    }
}

fn kill_tree(tracked: &mut TrackedChild) {
    if let Some(pid) = tracked.os_pid {
        let _ = kill_pid(pid);
    }
}

fn kill_pid(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() || status.code() == Some(128) {
            Ok(())
        } else {
            Err(format!("Could not stop PID {pid}"))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill").args(["-TERM", "-P", &pid.to_string()]).status();
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
        thread::sleep(Duration::from_millis(250));
        let _ = Command::new("pkill").args(["-KILL", "-P", &pid.to_string()]).status();
        let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).status();
        Ok(())
    }
}

fn fs_read(path: PathBuf) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

#[cfg(windows)]
mod windows_job {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};

    pub struct Job(HANDLE);

    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    pub fn assign(pid: u32) -> windows::core::Result<Job> {
        unsafe {
            let job_handle = CreateJobObjectW(None, None)?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job_handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )?;
            let process = OpenProcess(PROCESS_ALL_ACCESS, false, pid)?;
            AssignProcessToJobObject(job_handle, process)?;
            let _ = CloseHandle(process);
            Ok(Job(job_handle))
        }
    }
}
