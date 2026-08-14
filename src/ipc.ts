import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DiffResult,
  FileContentResult,
  FileSearchResult,
  FileTreeResult,
  PortConflict,
  Repository,
  WorkspaceState
} from "./types";
import { emptyWorkspace } from "./types";

export type CommandChunk = {
  id: string;
  data: string;
};

export type CommandExit = {
  id: string;
  exit_status: number | null;
  port_conflict?: PortConflict | null;
};

export async function workspaceSnapshot(): Promise<WorkspaceState> {
  return invoke("workspace_snapshot");
}

export async function addRepository(path: string): Promise<WorkspaceState> {
  return invoke("add_repository", { path });
}

export async function addRepositoryPick(): Promise<WorkspaceState> {
  return invoke("add_repository_pick");
}

export async function removeRepository(id: string): Promise<WorkspaceState> {
  return invoke("remove_repository", { id });
}

export async function reorderRepositories(ids: string[]): Promise<WorkspaceState> {
  return invoke("reorder_repositories", { ids });
}

export async function refreshRepository(id: string): Promise<Repository> {
  return invoke("refresh_repository", { id });
}

export async function gitOp(
  id: string,
  op: string,
  payload: Record<string, unknown> = {}
): Promise<void> {
  return invoke("git_op", { id, op, payload });
}

export async function runCommand(id: string, command: string): Promise<void> {
  return invoke("run_command", { id, command });
}

export async function stopCommand(id: string): Promise<void> {
  return invoke("stop_command", { id });
}

export async function replacePortCommand(id: string): Promise<void> {
  return invoke("replace_port_command", { id });
}

export async function requestDiff(id: string, path: string, staged: boolean): Promise<DiffResult> {
  return invoke("request_diff", { id, path, staged });
}

export async function requestFileTree(id: string): Promise<FileTreeResult> {
  return invoke("request_file_tree", { id });
}

export async function searchFiles(id: string, query: string): Promise<FileSearchResult> {
  return invoke("search_files", { id, query });
}

export async function requestFile(id: string, path: string): Promise<FileContentResult> {
  return invoke("request_file", { id, path });
}

export async function saveFile(id: string, path: string, content: string): Promise<FileContentResult> {
  return invoke("save_file", { id, path, content });
}

export async function openFileExternal(
  id: string,
  path: string,
  target?: "cursor" | "vscode" | "os"
): Promise<void> {
  return invoke("open_file_external", { id, path, target });
}

export async function listenWorkspace(handlers: {
  onWorkspace: (state: WorkspaceState) => void;
  onRepo: (repo: Repository) => void;
  onChunk: (chunk: CommandChunk) => void;
  onExit: (exit: CommandExit) => void;
}): Promise<() => void> {
  const unlisteners: UnlistenFn[] = [
    await listen<WorkspaceState>("workspace-changed", (event) => handlers.onWorkspace(event.payload)),
    await listen<Repository>("repo-updated", (event) => handlers.onRepo(event.payload)),
    await listen<CommandChunk>("cmd-chunk", (event) => handlers.onChunk(event.payload)),
    await listen<CommandExit>("cmd-exited", (event) => handlers.onExit(event.payload))
  ];
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

export { emptyWorkspace };
