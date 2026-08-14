import { createStore, reconcile } from "solid-js/store";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  DiffResult,
  FileContentResult,
  FileSearchResult,
  GitFile,
  Repository,
  TerminalState,
  WorkspaceState
} from "./types";
import { emptyWorkspace } from "./types";
import * as ipc from "./ipc";

function fileKey(id: string, path: string) {
  return `${id}:${path}`;
}

function mergeTerminal(current?: TerminalState, incoming?: TerminalState): TerminalState {
  const currentOut = current?.output || "";
  const incomingOut = incoming?.output || "";
  const sameCommand = (incoming?.command || null) === (current?.command || null);
  const keepStopped =
    Boolean(current) &&
    current?.running === false &&
    current?.exit_status != null &&
    incoming?.running === true &&
    sameCommand;

  return {
    running: keepStopped ? false : incoming?.running ?? current?.running ?? false,
    command: incoming?.command ?? current?.command ?? null,
    exit_status: keepStopped
      ? current?.exit_status ?? null
      : incoming?.exit_status ?? current?.exit_status ?? null,
    port_conflict: incoming?.port_conflict ?? current?.port_conflict ?? null,
    output: currentOut.length >= incomingOut.length ? currentOut : incomingOut
  };
}

export function useWorkspace() {
  const [state, setState] = createStore<WorkspaceState>(emptyWorkspace);
  const [connected, setConnected] = createSignal(false);
  const [transportError, setTransportError] = createSignal<string | null>(null);
  const [operationError, setOperationError] = createSignal<string | null>(null);
  const [diff, setDiff] = createSignal<DiffResult | null>(null);
  const [fileTrees, setFileTrees] = createSignal<Record<string, string[]>>({});
  const [fileSearches, setFileSearches] = createSignal<Record<string, FileSearchResult>>({});
  const [openFiles, setOpenFiles] = createSignal<Record<string, FileContentResult>>({});
  const [activeFileKey, setActiveFileKey] = createSignal<string | null>(null);
  const [drawerMode, setDrawerMode] = createSignal<"diff" | "edit" | null>(null);
  const activeFileBrowsers = new Set<string>();

  const applyWorkspace = (next: WorkspaceState) => {
    const ids = new Set(next.repositories.map((repository) => repository.id));
    const merged: WorkspaceState = {
      ...next,
      repositories: next.repositories.map((repository) => {
        const current = state.repositories.find((item) => item.id === repository.id);
        return current
          ? { ...repository, terminal: mergeTerminal(current.terminal, repository.terminal) }
          : repository;
      })
    };
    setState(reconcile(merged, { key: "id" }));
    setFileTrees((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
    setFileSearches((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
    setOpenFiles((current) =>
      Object.fromEntries(Object.entries(current).filter(([, file]) => ids.has(file.id)))
    );
    for (const id of [...activeFileBrowsers]) {
      if (!ids.has(id)) activeFileBrowsers.delete(id);
    }
    const active = activeFileKey();
    if (active && !ids.has(active.split(":")[0] || "")) {
      setActiveFileKey(null);
      setDrawerMode(diff() ? "diff" : null);
    }
  };

  const applyRepo = (repository: Repository) => {
    const index = state.repositories.findIndex((item) => item.id === repository.id);
    if (index < 0) return;
    const current = state.repositories[index];
    setState("repositories", index, reconcile({
      ...repository,
      terminal: mergeTerminal(current.terminal, repository.terminal)
    }));
  };

  const fail = (error: unknown) => {
    setOperationError(error instanceof Error ? error.message : String(error));
  };

  const send = async (event: string, payload: Record<string, unknown> = {}) => {
    setOperationError(null);
    const id = typeof payload.id === "string" ? payload.id : "";
    try {
      switch (event) {
        case "add_repository":
          applyWorkspace(await ipc.addRepository(String(payload.path || "")));
          break;
        case "add_repository_pick":
          applyWorkspace(await ipc.addRepositoryPick());
          break;
        case "remove_repository":
          applyWorkspace(await ipc.removeRepository(id));
          break;
        case "reorder_repositories":
          applyWorkspace(await ipc.reorderRepositories(payload.ids as string[]));
          break;
        case "refresh_repository":
          applyRepo(await ipc.refreshRepository(id));
          break;
        case "run_command":
          await ipc.runCommand(id, String(payload.command || ""));
          break;
        case "stop_command":
          await ipc.stopCommand(id);
          break;
        case "replace_port_command":
          await ipc.replacePortCommand(id);
          break;
        case "request_diff": {
          setDiff(null);
          const result = await ipc.requestDiff(id, String(payload.path || ""), payload.staged === true);
          setDiff(result);
          setDrawerMode("diff");
          break;
        }
        case "request_file_tree":
          if (id) activeFileBrowsers.add(id);
          {
            const result = await ipc.requestFileTree(id);
            if (activeFileBrowsers.has(id)) {
              setFileTrees((current) => ({ ...current, [id]: result.files }));
            }
          }
          break;
        case "search_files": {
          const query = String(payload.query || "").trim();
          if (!id) return;
          activeFileBrowsers.add(id);
          setFileSearches((current) => {
            if (!query) {
              const next = { ...current };
              delete next[id];
              return next;
            }
            const previous = current[id];
            return {
              ...current,
              [id]: { id, query, files: previous?.query === query ? previous.files : [] }
            };
          });
          if (!query) return;
          const result = await ipc.searchFiles(id, query);
          setFileSearches((current) =>
            current[id]?.query === result.query ? { ...current, [id]: result } : current
          );
          break;
        }
        case "request_file": {
          const result = await ipc.requestFile(id, String(payload.path || ""));
          const key = fileKey(result.id, result.path);
          setOpenFiles((current) => ({ ...current, [key]: result }));
          setActiveFileKey(key);
          setDrawerMode("edit");
          break;
        }
        case "save_file": {
          const result = await ipc.saveFile(id, String(payload.path || ""), String(payload.content || ""));
          const key = fileKey(result.id, result.path);
          setOpenFiles((current) => ({ ...current, [key]: result }));
          break;
        }
        case "open_file_external":
          await ipc.openFileExternal(
            id,
            String(payload.path || ""),
            payload.target as "cursor" | "vscode" | "os" | undefined
          );
          break;
        default:
          await ipc.gitOp(id, event, payload);
      }
    } catch (error) {
      fail(error);
    }
  };

  onMount(() => {
    let unlisten: (() => void) | undefined;
    ipc
      .workspaceSnapshot()
      .then((snapshot) => {
        applyWorkspace(snapshot);
        setConnected(true);
      })
      .catch(fail);

    ipc
      .listenWorkspace({
        onWorkspace: (next) => {
          applyWorkspace(next);
          setConnected(true);
          setTransportError(null);
        },
        onRepo: (repository) => applyRepo(repository),
        onChunk: (chunk) => {
          const index = state.repositories.findIndex((item) => item.id === chunk.id);
          if (index < 0) return;
          const current = state.repositories[index].terminal?.output || "";
          const next = `${current}${chunk.data}`;
          setState(
            "repositories",
            index,
            "terminal",
            "output",
            next.length > 32 * 1024 ? next.slice(next.length - 32 * 1024) : next
          );
          setState("repositories", index, "terminal", "running", true);
        },
        onExit: (exit) => {
          const index = state.repositories.findIndex((item) => item.id === exit.id);
          if (index < 0) return;
          setState("repositories", index, "terminal", "running", false);
          setState("repositories", index, "terminal", "exit_status", exit.exit_status);
          setState("repositories", index, "terminal", "port_conflict", exit.port_conflict || null);
        }
      })
      .then((stop) => {
        unlisten = stop;
      })
      .catch((error) => setTransportError(String(error)));

    onCleanup(() => unlisten?.());
  });

  const activeFile = createMemo(() => {
    const key = activeFileKey();
    return key ? openFiles()[key] || null : null;
  });

  const openFileList = createMemo(() => Object.values(openFiles()));

  return {
    state,
    connected,
    transportError,
    operationError,
    clearOperationError: () => setOperationError(null),
    diff,
    closeDiff: () => {
      setDiff(null);
      setDrawerMode(activeFile() ? "edit" : null);
    },
    fileTrees,
    fileSearches,
    openFiles,
    openFileList,
    activeFile,
    activeFileKey,
    setActiveFileKey,
    drawerMode,
    setDrawerMode,
    closeEditor: (key?: string) => {
      const target = key || activeFileKey();
      if (!target) return;
      const currentActive = activeFileKey();
      setOpenFiles((current) => {
        const next = { ...current };
        delete next[target];
        return next;
      });
      const remaining = Object.keys(openFiles()).filter((item) => item !== target);
      if (currentActive === target) {
        setActiveFileKey(remaining[0] || null);
        setDrawerMode(remaining[0] ? "edit" : diff() ? "diff" : null);
      } else if (remaining.length === 0) {
        setActiveFileKey(null);
        setDrawerMode(diff() ? "diff" : null);
      }
    },
    closeDrawer: () => {
      setDiff(null);
      setOpenFiles({});
      setActiveFileKey(null);
      setDrawerMode(null);
    },
    releaseFileBrowser: (id: string) => {
      activeFileBrowsers.delete(id);
      setFileTrees((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setFileSearches((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    send: (event: string, payload: Record<string, unknown> = {}) => {
      void send(event, payload);
    },
    stageFile: (repository: Repository, file: GitFile) => {
      void send("stage", { id: repository.id, path: file.path });
    }
  };
}
