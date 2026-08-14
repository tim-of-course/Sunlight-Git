import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import { useWorkspace } from "./workspaceState";
import { moveRepository } from "./workspaceOrder";
import {
  repositoryScrollLeft,
  repositoryVisibility
} from "./repositoryNavigation";
import { DiffViewer } from "./components/DiffViewer";
import { EditorDrawer } from "./components/EditorDrawer";
import { RepositoryColumn } from "./components/RepositoryColumn";
import { RepositorySidebar } from "./components/RepositorySidebar";
import { fileBasename, fileKey, formatBytes } from "./ui";
import logo from "./assets/logo.svg";

type EditorDraft = {
  content: string;
  saved: string;
  dirty: boolean;
};

export function App() {
  const live = useWorkspace();
  const [path, setPath] = createSignal("");
  const [editorDirtyFlag, setEditorDirtyFlag] = createSignal(false);
  const [dirtyFiles, setDirtyFiles] = createSignal<Record<string, boolean>>({});
  const [editorResetKey, setEditorResetKey] = createSignal(0);
  const [workspaceElement, setWorkspaceElement] = createSignal<HTMLElement | null>(null);
  const [visibleRepositoryIds, setVisibleRepositoryIds] = createSignal<string[]>([]);
  const [primaryRepositoryId, setPrimaryRepositoryId] = createSignal<string | null>(null);
  const repositoryElements = new Map<string, HTMLElement>();
  const drafts = new Map<string, EditorDraft>();
  let editorDraftContent = "";
  let currentEditorKey: string | null = null;
  let editorDirtyCheckTimer: number | null = null;
  let visibilityFrame: number | null = null;
  let draggedId: string | null = null;

  const editorDirty = () => Boolean(live.activeFile()) && editorDirtyFlag();
  const anyEditorDirty = () =>
    editorDirty() || Object.values(dirtyFiles()).some(Boolean);
  const activeFileSearchQuery = createMemo(() => {
    const file = live.activeFile();
    return file ? live.fileSearches()[file.id]?.query || "" : "";
  });

  const setFileDirty = (key: string, dirty: boolean) => {
    setDirtyFiles((current) => (current[key] === dirty ? current : { ...current, [key]: dirty }));
  };

  const clearFileDraft = (key: string) => {
    drafts.delete(key);
    setDirtyFiles((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const releaseEditorBuffers = () => {
    editorDraftContent = "";
    currentEditorKey = null;
    drafts.clear();
    setDirtyFiles({});
    setEditorDirtyFlag(false);
  };

  createEffect(() => {
    const file = live.activeFile();
    if (!file) {
      currentEditorKey = null;
      editorDraftContent = "";
      setEditorDirtyFlag(false);
      return;
    }

    const key = fileKey(file.id, file.path);
    const serverContent = file.content;
    const existing = drafts.get(key);
    const switched = currentEditorKey !== key;
    currentEditorKey = key;

    if (!existing) {
      editorDraftContent = serverContent;
      drafts.set(key, { content: serverContent, saved: serverContent, dirty: false });
      setEditorDirtyFlag(false);
      setFileDirty(key, false);
      setEditorResetKey((value) => value + 1);
      return;
    }

    if (switched) {
      editorDraftContent = existing.content;
      setEditorDirtyFlag(existing.dirty);
      setEditorResetKey((value) => value + 1);
      return;
    }

    if (!existing.dirty && existing.saved !== serverContent) {
      editorDraftContent = serverContent;
      drafts.set(key, { content: serverContent, saved: serverContent, dirty: false });
      setEditorDirtyFlag(false);
      setFileDirty(key, false);
      setEditorResetKey((value) => value + 1);
    }
  });

  const updateEditorDraft = (content: string) => {
    editorDraftContent = content;
    const file = live.activeFile();
    if (!file) return;
    const key = fileKey(file.id, file.path);
    const saved = drafts.get(key)?.saved ?? file.content;
    const dirty = content !== saved;
    drafts.set(key, { content, saved, dirty });
    if (editorDirtyFlag() !== dirty) setEditorDirtyFlag(dirty);
    setFileDirty(key, dirty);

    if (editorDirtyCheckTimer !== null) window.clearTimeout(editorDirtyCheckTimer);
    editorDirtyCheckTimer = window.setTimeout(() => {
      editorDirtyCheckTimer = null;
      const active = live.activeFile();
      const stillDirty = Boolean(active) && editorDraftContent !== (drafts.get(fileKey(active!.id, active!.path))?.saved ?? active!.content);
      setEditorDirtyFlag(stillDirty);
      if (active) setFileDirty(fileKey(active.id, active.path), stillDirty);
    }, 250);
  };

  onCleanup(() => {
    if (editorDirtyCheckTimer !== null) window.clearTimeout(editorDirtyCheckTimer);
  });

  const closeDrawer = () => {
    if (live.drawerMode() === "edit" && anyEditorDirty() && !window.confirm("Discard unsaved editor changes?")) {
      return;
    }

    live.closeDrawer();
    releaseEditorBuffers();
  };

  const closeEditor = (key?: string) => {
    const file = live.activeFile();
    const target = key || (file ? fileKey(file.id, file.path) : null);
    if (!target) return;
    if (dirtyFiles()[target] && !window.confirm("Discard unsaved editor changes?")) return;
    live.closeEditor(target);
    clearFileDraft(target);
    if (!live.openFileList().length && !live.diff()) {
      releaseEditorBuffers();
    }
  };

  const addRepository = (event: SubmitEvent) => {
    event.preventDefault();
    const value = path().trim();
    if (!value) return;
    live.send("add_repository", { path: value });
    setPath("");
  };

  const dropBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const ids = moveRepository(
      live.state.repositories.map((repository) => repository.id),
      draggedId,
      targetId
    );
    live.send("reorder_repositories", { ids });
    draggedId = null;
  };

  const updateRepositoryVisibility = () => {
    const workspace = workspaceElement();
    if (!workspace) return;

    const repositoryRects = live.state.repositories.flatMap((repository) => {
      const element = repositoryElements.get(repository.id);
      return element ? [{ id: repository.id, rect: element.getBoundingClientRect() }] : [];
    });
    const visibility = repositoryVisibility(workspace.getBoundingClientRect(), repositoryRects);
    setVisibleRepositoryIds(visibility.visibleIds);
    setPrimaryRepositoryId(visibility.primaryId);
  };

  const queueRepositoryVisibilityUpdate = () => {
    if (visibilityFrame !== null) return;
    visibilityFrame = window.requestAnimationFrame(() => {
      visibilityFrame = null;
      updateRepositoryVisibility();
    });
  };

  const setRepositoryElement = (id: string, element: HTMLElement) => {
    repositoryElements.set(id, element);
    queueRepositoryVisibilityUpdate();
  };

  const scrollToRepository = (id: string) => {
    const workspace = workspaceElement();
    const target = repositoryElements.get(id);
    if (!workspace || !target) return;

    const repositories = live.state.repositories;
    const targetIndex = repositories.findIndex((repository) => repository.id === id);
    const previous =
      targetIndex > 0 ? repositoryElements.get(repositories[targetIndex - 1].id) : null;
    const workspaceRect = workspace.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const previousRect = previous?.getBoundingClientRect();
    const gap = previousRect ? targetRect.left - previousRect.right : 0;

    workspace.scrollTo({
      left: repositoryScrollLeft({
        workspaceScrollLeft: workspace.scrollLeft,
        workspaceLeft: workspaceRect.left,
        targetLeft: targetRect.left,
        targetIndex,
        gap,
        maxScrollLeft: workspace.scrollWidth - workspace.clientWidth
      }),
      behavior: "smooth"
    });
  };

  createEffect(() => {
    const ids = new Set(live.state.repositories.map((repository) => repository.id));
    for (const id of repositoryElements.keys()) {
      if (!ids.has(id)) repositoryElements.delete(id);
    }
    queueRepositoryVisibilityUpdate();
  });

  createEffect(() => {
    const workspace = workspaceElement();
    if (!workspace) return;

    const update = () => queueRepositoryVisibilityUpdate();
    workspace.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();

    onCleanup(() => {
      workspace.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (visibilityFrame !== null) {
        window.cancelAnimationFrame(visibilityFrame);
        visibilityFrame = null;
      }
    });
  });

  return (
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-mark" src={logo} width="36" height="36" alt="Sunlight" />
          <div>
            <strong>Sunlight</strong>
            <span>Shine some light on your work</span>
          </div>
        </div>

        <form class="add-repository" onSubmit={addRepository}>
          <input
            aria-label="Repository path"
            list="recent-repositories"
            placeholder="Paste a local repository path"
            value={path()}
            onInput={(event) => setPath(event.currentTarget.value)}
          />
          <datalist id="recent-repositories">
            <For each={live.state.recents}>
              {(recent) => <option value={recent} />}
            </For>
          </datalist>
          <div class="add-repository-actions">
            <button type="button" onClick={() => live.send("add_repository_pick")}>Browse</button>
            <button type="submit">Add repository</button>
          </div>
        </form>

        <div class={live.connected() ? "connection online" : "connection offline"}>
          <span />
          {live.connected() ? "Connected" : "Connecting"}
        </div>
      </header>

      <Show when={live.transportError() || live.operationError() || live.state.workspace_error}>
        <div class="global-error">
          <span>
            {live.transportError() || live.operationError() || live.state.workspace_error}
          </span>
          <button type="button" onClick={live.clearOperationError}>Dismiss</button>
        </div>
      </Show>

      <Show
        when={live.state.repositories.length > 0}
        fallback={
          <section class="empty-workspace">
            <div class="empty-icon">+/-</div>
            <h1>Open your working repositories</h1>
            <p>Paste a local Git repository path above. Each repository opens in its own column.</p>
          </section>
        }
      >
        <div class="workspace-shell">
          <RepositorySidebar
            repositories={live.state.repositories}
            visibleRepositoryIds={visibleRepositoryIds()}
            primaryRepositoryId={primaryRepositoryId()}
            onSelectRepository={scrollToRepository}
          />
          <main
            class="workspace"
            aria-label="Repositories"
            ref={(element) => setWorkspaceElement(element)}
          >
            <Key each={live.state.repositories} by={(repository) => repository.id}>
              {(repository) => (
                <RepositoryColumn
                  repository={repository()}
                  send={live.send}
                  fileTree={live.fileTrees()[repository().id] || []}
                  fileSearch={live.fileSearches()[repository().id] || null}
                  activeFilePath={
                    live.activeFile()?.id === repository().id ? live.activeFile()?.path || null : null
                  }
                  onDiff={(file, staged) =>
                    live.send("request_diff", {
                      id: repository().id,
                      path: file.path,
                      staged
                    })
                  }
                  onRequestFileTree={() =>
                    live.send("request_file_tree", {
                      id: repository().id
                    })
                  }
                  onReleaseFileBrowser={() => live.releaseFileBrowser(repository().id)}
                  onSearchFileContents={(query) =>
                    live.send("search_files", {
                      id: repository().id,
                      query
                    })
                  }
                  onOpenFile={(filePath) =>
                    live.send("request_file", {
                      id: repository().id,
                      path: filePath
                    })
                  }
                  onOpenExternalFile={(filePath) =>
                    live.send("open_file_external", {
                      id: repository().id,
                      path: filePath
                    })
                  }
                  onOpenInCursor={(filePath) =>
                    live.send("open_file_external", {
                      id: repository().id,
                      path: filePath,
                      target: "cursor"
                    })
                  }
                  onDragStart={() => {
                    draggedId = repository().id;
                  }}
                  onDrop={() => dropBefore(repository().id)}
                  onColumnRef={(element) => setRepositoryElement(repository().id, element)}
                />
              )}
            </Key>
          </main>
        </div>
      </Show>

      <Show when={live.drawerMode()}>
        {(mode) => (
          <div class="drawer-backdrop" onClick={closeDrawer}>
            <aside class="diff-drawer" onClick={(event) => event.stopPropagation()}>
              <header>
                <div class="drawer-tabs" role="tablist" aria-label="File drawer">
                  <button
                    type="button"
                    class={mode() === "diff" ? "active" : ""}
                    disabled={!live.diff()}
                    onClick={() => live.setDrawerMode("diff")}
                  >
                    Diff
                  </button>
                  <button
                    type="button"
                    class={mode() === "edit" ? "active" : ""}
                    disabled={!live.activeFile()}
                    onClick={() => live.setDrawerMode("edit")}
                  >
                    Edit
                  </button>
                </div>
                <Show
                  when={mode() === "edit" && live.openFileList().length > 1}
                  fallback={
                    <div class="drawer-title">
                      <Show
                        when={mode() === "diff" && live.diff()}
                        fallback={
                          <Show when={live.activeFile()}>
                            {(file) => (
                              <>
                                <span class="badge">Editing</span>
                                <strong>{file().path}</strong>
                              </>
                            )}
                          </Show>
                        }
                      >
                        {(diff) => (
                          <>
                            <span class={diff().staged ? "badge staged" : "badge"}>
                              {diff().staged ? "Staged" : "Working tree"}
                            </span>
                            <strong>{diff().file}</strong>
                          </>
                        )}
                      </Show>
                    </div>
                  }
                >
                  <div class="drawer-file-tabs" role="tablist" aria-label="Open files">
                    <For each={live.openFileList()}>
                      {(file) => {
                        const key = fileKey(file.id, file.path);
                        const active = () => live.activeFileKey() === key;
                        return (
                          <button
                            type="button"
                            class={`drawer-file-tab${active() ? " active" : ""}`}
                            title={file.path}
                            onClick={() => {
                              live.setActiveFileKey(key);
                              live.setDrawerMode("edit");
                            }}
                          >
                            <span>
                              {fileBasename(file.path)}
                              {dirtyFiles()[key] ? " •" : ""}
                            </span>
                            <span
                              class="tab-close"
                              role="button"
                              aria-label={`Close ${file.path}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                closeEditor(key);
                              }}
                            >
                              x
                            </span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
                <button type="button" class="icon-button" onClick={closeDrawer} aria-label="Close drawer">x</button>
              </header>
              <Show
                when={mode() === "diff"}
                fallback={
                  <EditorDrawer
                    file={live.activeFile()}
                    initialContent={editorDraftContent}
                    resetKey={editorResetKey()}
                    searchQuery={activeFileSearchQuery()}
                    dirty={editorDirty()}
                    onChange={updateEditorDraft}
                    onOpenExternal={() => {
                      const file = live.activeFile();
                      if (file) {
                        live.send("open_file_external", {
                          id: file.id,
                          path: file.path
                        });
                      }
                    }}
                    onOpenInCursor={() => {
                      const file = live.activeFile();
                      if (file) {
                        live.send("open_file_external", {
                          id: file.id,
                          path: file.path,
                          target: "cursor"
                        });
                      }
                    }}
                    onSave={() => {
                      const file = live.activeFile();
                      if (file) {
                        const key = fileKey(file.id, file.path);
                        drafts.set(key, {
                          content: editorDraftContent,
                          saved: editorDraftContent,
                          dirty: false
                        });
                        setEditorDirtyFlag(false);
                        setFileDirty(key, false);
                        live.send("save_file", {
                          id: file.id,
                          path: file.path,
                          content: editorDraftContent
                        });
                      }
                    }}
                    onClose={() => closeEditor()}
                  />
                }
              >
                <Show when={live.diff()} fallback={<div class="binary-notice">No diff selected.</div>}>
                  {(diff) => (
                    <Show when={!diff().binary} fallback={<div class="binary-notice">Binary file changed. Text diff is unavailable.</div>}>
                      <Show when={diff().truncated}>
                        <div class="truncated">Diff truncated at {formatBytes(diff().limit)}.</div>
                      </Show>
                      <DiffViewer content={diff().content} />
                    </Show>
                  )}
                </Show>
              </Show>
            </aside>
          </div>
        )}
      </Show>
    </div>
  );
}

export default App;
