mod cmd;
mod error;
mod files;
mod git;
mod repo;
mod types;
mod workspace;

use repo::Repo;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use types::{
    DiffResult, FileContentResult, FileSearchResult, FileTreeResult, Repository, WorkspaceState,
};

pub struct AppState {
    repos: Mutex<Vec<Arc<Repo>>>,
    recents: Mutex<Vec<String>>,
    workspace_error: Mutex<Option<String>>,
}

impl AppState {
    fn snapshot(&self) -> WorkspaceState {
        let repos = self.repos.lock().map(|repos| repos.clone()).unwrap_or_default();
        WorkspaceState {
            repositories: repos.iter().map(|repo| repo.snapshot()).collect(),
            recents: self.recents.lock().map(|value| value.clone()).unwrap_or_default(),
            workspace_error: self
                .workspace_error
                .lock()
                .ok()
                .and_then(|value| value.clone()),
        }
    }

    fn repo(&self, id: &str) -> Result<Arc<Repo>, String> {
        self.repos
            .lock()
            .map_err(|error| error.to_string())?
            .iter()
            .find(|repo| repo.id == id)
            .cloned()
            .ok_or_else(|| "Repository is not open".to_string())
    }

    fn persist(&self) -> Result<(), String> {
        let repos = self.repos.lock().map_err(|error| error.to_string())?;
        let recents = self.recents.lock().map_err(|error| error.to_string())?;
        workspace::save(&workspace::StoredWorkspace {
            version: 1,
            repositories: repos
                .iter()
                .map(|repo| repo.path.to_string_lossy().into_owned())
                .collect(),
            recents: recents.clone(),
        })
    }

    fn set_error(&self, message: Option<String>) {
        if let Ok(mut error) = self.workspace_error.lock() {
            *error = message;
        }
    }
}

#[tauri::command]
fn workspace_snapshot(state: State<AppState>) -> WorkspaceState {
    state.snapshot()
}

#[tauri::command]
fn add_repository(app: AppHandle, state: State<AppState>, path: String) -> Result<WorkspaceState, String> {
    let canonical = git::canonical_root(&path)?;
    let canonical_str = canonical.to_string_lossy().into_owned();
    {
        let repos = state.repos.lock().map_err(|error| error.to_string())?;
        if repos.iter().any(|repo| {
            repo.path.to_string_lossy().eq_ignore_ascii_case(&canonical_str)
        }) {
            return Err("Repository is already open".into());
        }
    }
    let repo = Repo::open(canonical)?;
    if let Ok(mut handle) = repo.app.lock() {
        *handle = Some(app.clone());
    }
    {
        let mut repos = state.repos.lock().map_err(|error| error.to_string())?;
        repos.push(repo);
    }
    {
        let mut recents = state.recents.lock().map_err(|error| error.to_string())?;
        *recents = workspace::put_recent(&recents, &canonical_str);
    }
    state.set_error(None);
    state.persist()?;
    let snapshot = state.snapshot();
    let _ = app.emit("workspace-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn add_repository_pick(app: AppHandle, state: State<AppState>) -> Result<WorkspaceState, String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Add repository")
        .blocking_pick_folder();
    let Some(folder) = folder else {
        return Ok(state.snapshot());
    };
    let path = folder
        .into_path()
        .map_err(|error| error.to_string())?
        .to_string_lossy()
        .into_owned();
    add_repository(app, state, path)
}

#[tauri::command]
fn remove_repository(app: AppHandle, state: State<AppState>, id: String) -> Result<WorkspaceState, String> {
    let repo = state.repo(&id)?;
    let snapshot = repo.snapshot();
    if snapshot.busy.is_some() {
        return Err(format!(
            "Wait for {} to finish before closing this repository",
            snapshot.busy.unwrap()
        ));
    }
    repo.close();
    {
        let mut repos = state.repos.lock().map_err(|error| error.to_string())?;
        repos.retain(|item| item.id != id);
    }
    state.set_error(None);
    state.persist()?;
    let snapshot = state.snapshot();
    let _ = app.emit("workspace-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn reorder_repositories(
    app: AppHandle,
    state: State<AppState>,
    ids: Vec<String>,
) -> Result<WorkspaceState, String> {
    {
        let mut repos = state.repos.lock().map_err(|error| error.to_string())?;
        repos.sort_by_key(|repo| {
            ids.iter()
                .position(|id| id == &repo.id)
                .unwrap_or(usize::MAX)
        });
    }
    state.persist()?;
    let snapshot = state.snapshot();
    let _ = app.emit("workspace-changed", &snapshot);
    Ok(snapshot)
}

#[tauri::command]
fn refresh_repository(state: State<AppState>, id: String) -> Result<Repository, String> {
    state.repo(&id)?.refresh()
}

#[tauri::command]
async fn git_op(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
    op: String,
    payload: Value,
) -> Result<(), String> {
    let repo = state.repo(&id)?;
    tauri::async_runtime::spawn_blocking(move || repo.perform(&op, payload, &app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn run_command(state: State<AppState>, app: AppHandle, id: String, command: String) -> Result<(), String> {
    state.repo(&id)?.run_command(&command, &app)
}

#[tauri::command]
fn stop_command(state: State<AppState>, app: AppHandle, id: String) -> Result<(), String> {
    state.repo(&id)?.stop_command(&app)
}

#[tauri::command]
fn replace_port_command(state: State<AppState>, app: AppHandle, id: String) -> Result<(), String> {
    state.repo(&id)?.replace_port_command(&app)
}

#[tauri::command]
fn request_diff(state: State<AppState>, id: String, path: String, staged: bool) -> Result<DiffResult, String> {
    state.repo(&id)?.diff(&path, staged)
}

#[tauri::command]
fn request_file_tree(state: State<AppState>, id: String) -> Result<FileTreeResult, String> {
    state.repo(&id)?.list_files()
}

#[tauri::command]
fn search_files(state: State<AppState>, id: String, query: String) -> Result<FileSearchResult, String> {
    state.repo(&id)?.search_files(&query)
}

#[tauri::command]
fn request_file(state: State<AppState>, id: String, path: String) -> Result<FileContentResult, String> {
    state.repo(&id)?.read_file(&path)
}

#[tauri::command]
fn save_file(
    state: State<AppState>,
    app: AppHandle,
    id: String,
    path: String,
    content: String,
) -> Result<FileContentResult, String> {
    state.repo(&id)?.write_file(&path, &content, &app)
}

#[tauri::command]
fn open_file_external(
    state: State<AppState>,
    id: String,
    path: String,
    target: Option<String>,
) -> Result<(), String> {
    state.repo(&id)?.open_external(&path, target.as_deref())
}

fn restore_workspace(app: &AppHandle, state: &AppState) {
    let stored = workspace::load();
    if let Ok(mut recents) = state.recents.lock() {
        *recents = stored.recents.clone();
    }
    let mut failures = Vec::new();
    for path in stored.repositories {
        match git::canonical_root(&path).and_then(Repo::open) {
            Ok(repo) => {
                if let Ok(mut handle) = repo.app.lock() {
                    *handle = Some(app.clone());
                }
                if let Ok(mut repos) = state.repos.lock() {
                    repos.push(repo);
                }
            }
            Err(reason) => failures.push(format!("{path} ({reason})")),
        }
    }
    if !failures.is_empty() {
        state.set_error(Some(format!(
            "Could not restore {} repositories: {}. They were removed from the open workspace but remain in Recents.",
            failures.len(),
            failures.join(", ")
        )));
        let _ = state.persist();
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Open Sunlight", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                if let Some(app) = tray.app_handle().get_webview_window("main") {
                    let _ = app.show();
                    let _ = app.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            repos: Mutex::new(vec![]),
            recents: Mutex::new(vec![]),
            workspace_error: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();
            restore_workspace(&handle, &*state);
            setup_tray(&handle)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_snapshot,
            add_repository,
            add_repository_pick,
            remove_repository,
            reorder_repositories,
            refresh_repository,
            git_op,
            run_command,
            stop_command,
            replace_port_command,
            request_diff,
            request_file_tree,
            search_files,
            request_file,
            save_file,
            open_file_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sunlight");
}
