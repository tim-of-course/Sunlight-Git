import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  buildFileTree,
  directoryDefaultExpanded,
  filterFilePaths,
  joinRepoFilePath,
  type FileTreeNode
} from "../fileBrowser";
import type { FileSearchResult } from "../types";

export function FileBrowser(props: {
  files: string[];
  fileSearch: FileSearchResult | null;
  selectedPath: string | null;
  onRefresh: () => void;
  onSearchContents: (query: string) => void;
  onOpen: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onOpenInCursor: (path: string) => void;
  onCreateFile: (path: string) => void;
}) {
  const [filterQuery, setFilterQuery] = createSignal("");
  const [contentQuery, setContentQuery] = createSignal("");
  const [creatingAtRoot, setCreatingAtRoot] = createSignal(false);
  const trimmedContentQuery = createMemo(() => contentQuery().trim());
  const activeSearch = createMemo(() =>
    props.fileSearch?.query === trimmedContentQuery() ? props.fileSearch : null
  );
  const searchPending = createMemo(
    () => Boolean(trimmedContentQuery()) && props.fileSearch?.query !== trimmedContentQuery()
  );
  const filteredFiles = createMemo(() =>
    filterFilePaths(props.files, filterQuery(), trimmedContentQuery(), activeSearch()?.files || null)
  );
  const tree = createMemo(() => buildFileTree(filteredFiles()));
  const filtersActive = createMemo(() => Boolean(filterQuery().trim() || trimmedContentQuery()));
  const emptyText = createMemo(() => {
    if (props.files.length === 0) return "No files found";
    if (searchPending()) return "Searching contents...";
    return "No files match";
  });
  const createFileIn = (folder: string, name: string) => {
    const path = joinRepoFilePath(folder, name);
    if (!path) return false;
    props.onCreateFile(path);
    return true;
  };

  createEffect(() => {
    const query = trimmedContentQuery();
    const timeout = window.setTimeout(() => props.onSearchContents(query), query ? 250 : 0);
    onCleanup(() => window.clearTimeout(timeout));
  });

  return (
    <div class="file-browser">
      <div class="file-tree-panel">
        <header class="file-browser-toolbar">
          <strong>Files</strong>
          <div class="file-browser-tools">
            <input
              aria-label="Filter files by name"
              placeholder="Filter files"
              value={filterQuery()}
              onInput={(event) => setFilterQuery(event.currentTarget.value)}
            />
            <input
              aria-label="Search file contents"
              placeholder="Search contents"
              value={contentQuery()}
              onInput={(event) => setContentQuery(event.currentTarget.value)}
            />
            <button type="button" onClick={props.onRefresh}>Refresh</button>
          </div>
        </header>
        <div class="file-tree">
          <Show when={tree().length > 0} fallback={
            <Show when={!creatingAtRoot()}>
              <p class="history-empty">{emptyText()}</p>
            </Show>
          }>
            <FileTree
              nodes={tree()}
              selectedPath={props.selectedPath}
              autoExpandDirectories={filtersActive()}
              onOpen={props.onOpen}
              onOpenExternal={props.onOpenExternal}
              onOpenInCursor={props.onOpenInCursor}
              onCreateFile={createFileIn}
            />
          </Show>
          <Show
            when={creatingAtRoot()}
            fallback={
              <button
                type="button"
                class="tree-row tree-new-root"
                title="Create a file in the repository root"
                onClick={() => setCreatingAtRoot(true)}
              >
                New file in Root
              </button>
            }
          >
            <NewFileRow
              depth={0}
              onSubmit={(name) => {
                if (createFileIn("", name)) setCreatingAtRoot(false);
              }}
              onCancel={() => setCreatingAtRoot(false)}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}

function FileTree(props: {
  nodes: FileTreeNode[];
  selectedPath: string | null;
  autoExpandDirectories: boolean;
  depth?: number;
  onOpen: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onOpenInCursor: (path: string) => void;
  onCreateFile: (folder: string, name: string) => boolean;
}) {
  return (
    <For each={props.nodes}>
      {(node) => (
        <FileTreeEntry
          node={node}
          selectedPath={props.selectedPath}
          autoExpandDirectories={props.autoExpandDirectories}
          depth={props.depth || 0}
          onOpen={props.onOpen}
          onOpenExternal={props.onOpenExternal}
          onOpenInCursor={props.onOpenInCursor}
          onCreateFile={props.onCreateFile}
        />
      )}
    </For>
  );
}

function FileTreeEntry(props: {
  node: FileTreeNode;
  selectedPath: string | null;
  autoExpandDirectories: boolean;
  depth: number;
  onOpen: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onOpenInCursor: (path: string) => void;
  onCreateFile: (folder: string, name: string) => boolean;
}) {
  const [expanded, setExpanded] = createSignal(directoryDefaultExpanded);
  const [creating, setCreating] = createSignal(false);
  const isDirectory = () => props.node.kind === "directory";
  const containsSelected = () => {
    const selected = props.selectedPath;
    return Boolean(
      isDirectory() &&
        selected &&
        (selected === props.node.path || selected.startsWith(`${props.node.path}/`))
    );
  };
  const open = () => isDirectory() && (expanded() || props.autoExpandDirectories || creating());

  createEffect(() => {
    if (containsSelected()) setExpanded(true);
  });

  return (
    <>
      <div class={isDirectory() ? "tree-entry directory" : "tree-entry"}>
        <button
          type="button"
          class={`tree-row ${isDirectory() ? "directory" : "file"}${props.selectedPath === props.node.path ? " selected" : ""}`}
          style={`padding-left: ${8 + props.depth * 13}px`}
          title={props.node.path}
          aria-expanded={isDirectory() ? (open() ? "true" : "false") : undefined}
          onClick={() => {
            if (isDirectory()) {
              setExpanded((value) => !value);
            } else {
              props.onOpen(props.node.path);
            }
          }}
        >
          <span class={open() ? "tree-caret open" : "tree-caret"}>
            {isDirectory() ? ">" : ""}
          </span>
          <span class={isDirectory() ? "tree-icon directory" : "tree-icon file"}>
            {isDirectory() ? "D" : "F"}
          </span>
          <span>{props.node.name}</span>
        </button>
        <div class="tree-file-actions">
          <Show when={isDirectory()}>
            <button
              type="button"
              class="tree-open-external"
              title={`Create a file in ${props.node.path}`}
              aria-label={`Create a file in ${props.node.path}`}
              onClick={() => {
                setExpanded(true);
                setCreating(true);
              }}
            >
              New
            </button>
          </Show>
          <Show when={!isDirectory()}>
            <button
              type="button"
              class="tree-open-external"
              title={`Open ${props.node.path} outside Sunlight`}
              aria-label={`Open ${props.node.path} outside Sunlight`}
              onClick={() => props.onOpenExternal(props.node.path)}
            >
              Open
            </button>
            <button
              type="button"
              class="tree-open-external"
              title={`Open ${props.node.path} in Cursor`}
              aria-label={`Open ${props.node.path} in Cursor`}
              onClick={() => props.onOpenInCursor(props.node.path)}
            >
              Cursor
            </button>
          </Show>
        </div>
      </div>
      <Show when={open()}>
        <Show when={creating()}>
          <NewFileRow
            depth={props.depth + 1}
            onSubmit={(name) => {
              if (props.onCreateFile(props.node.path, name)) setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Show>
        <FileTree
          nodes={props.node.children}
          selectedPath={props.selectedPath}
          autoExpandDirectories={props.autoExpandDirectories}
          depth={props.depth + 1}
          onOpen={props.onOpen}
          onOpenExternal={props.onOpenExternal}
          onOpenInCursor={props.onOpenInCursor}
          onCreateFile={props.onCreateFile}
        />
      </Show>
    </>
  );
}

function NewFileRow(props: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal("");

  const submit = () => {
    const value = name().trim();
    if (!value) return;
    props.onSubmit(value);
  };

  return (
    <div class="tree-entry new-file">
      <form
        class="tree-new-file"
        style={`padding-left: ${8 + props.depth * 13}px`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <span class="tree-caret" />
        <span class="tree-icon file">F</span>
        <input
          ref={(element) => {
            if (element) queueMicrotask(() => element.focus());
          }}
          aria-label="New file name"
          placeholder="file name"
          value={name()}
          onInput={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              props.onCancel();
            }
          }}
        />
      </form>
    </div>
  );
}
