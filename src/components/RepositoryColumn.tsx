import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { FileSearchResult, GitFile, Repository } from "../types";
import { clamp, humanize, type Send } from "../ui";
import { CommitHistory } from "./CommitHistory";
import { FileBrowser } from "./FileBrowser";
import { FileGroup } from "./FileGroup";

export function RepositoryColumn(props: {
  repository: Repository;
  send: Send;
  fileTree: string[];
  fileSearch: FileSearchResult | null;
  activeFilePath: string | null;
  onDiff: (file: GitFile, staged: boolean) => void;
  onRequestFileTree: () => void;
  onReleaseFileBrowser: () => void;
  onSearchFileContents: (query: string) => void;
  onOpenFile: (path: string) => void;
  onOpenExternalFile: (path: string) => void;
  onOpenInCursor: (path: string) => void;
  onCreateFile: (path: string) => void;
  onColumnRef: (element: HTMLElement) => void;
}) {
  const [commitMessage, setCommitMessage] = createSignal("");
  const [remote, setRemote] = createSignal("");
  const [remoteBranch, setRemoteBranch] = createSignal("");
  const [selectedBranch, setSelectedBranch] = createSignal("");
  const [newBranch, setNewBranch] = createSignal("");
  const [trackingLocal, setTrackingLocal] = createSignal("");
  const [stashMessage, setStashMessage] = createSignal("");
  const [includeUntracked, setIncludeUntracked] = createSignal(false);
  const [selectedCommit, setSelectedCommit] = createSignal<string | null>(null);
  const [command, setCommand] = createSignal("");
  const [commandsOpen, setCommandsOpen] = createSignal(false);
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(true);
  const [bottomTab, setBottomTab] = createSignal<"history" | "files">("history");
  const [bottomPanelHeight, setBottomPanelHeight] = createSignal(260);
  let terminalOutput: HTMLPreElement | undefined;

  const terminal = createMemo(() => props.repository.terminal || {
    running: false,
    command: null,
    output: "",
    exit_status: null,
    port_conflict: null
  });
  const gitBusy = () => Boolean(props.repository.busy);
  const commandRunning = () => terminal().running;
  const send = (event: string, payload: Record<string, unknown> = {}) =>
    props.send(event, { id: props.repository.id, ...payload });

  const selectedRemote = () => remote() || props.repository.remote || props.repository.remotes[0] || "";
  const selectedRemoteBranch = () => remoteBranch();
  const localBranches = createMemo(() => props.repository.branches.filter((branch) => !branch.remote));
  const remoteBranches = createMemo(() => {
    const selected = selectedRemote();
    const prefix = `refs/remotes/${selected}/`;

    return props.repository.branches.filter(
      (branch) => branch.remote && (!selected || branch.full_name.startsWith(prefix))
    );
  });
  const activeLocalBranch = () =>
    Boolean(props.repository.head) && !props.repository.unborn && !props.repository.detached;
  const canPush = () => activeLocalBranch() && Boolean(props.repository.upstream || selectedRemote());
  const pushPayload = () => {
    if (remote()) return { remote: remote(), branch: props.repository.head };
    if (props.repository.upstream) return { use_upstream: true };
    return { remote: selectedRemote(), branch: props.repository.head };
  };
  const pushLabel = () => {
    if (!remote() && props.repository.upstream) return "Push upstream";
    return selectedRemote() ? `Publish to ${selectedRemote()}` : "Publish";
  };
  const pullBranch = () => {
    const selected = selectedRemoteBranch();
    const branch = remoteBranches().find((item) => item.name === selected);
    const prefix = `refs/remotes/${selectedRemote()}/`;

    return branch?.full_name.startsWith(prefix) ? branch.full_name.slice(prefix.length) : "";
  };
  const canPull = () => Boolean(props.repository.upstream || pullBranch());
  const canSetUpstream = () => activeLocalBranch() && Boolean(pullBranch());

  createEffect(() => {
    const local = selectedBranch();
    const localBranchNames = localBranches().map((branch) => branch.name);
    const remoteName = selectedRemoteBranch();
    const remoteBranchNames = remoteBranches().map((branch) => branch.name);

    if (local && !localBranchNames.includes(local)) {
      setSelectedBranch("");
    }

    if (remoteName && !remoteBranchNames.includes(remoteName)) {
      setRemoteBranch("");
    }
  });

  const submitCommit = (event: SubmitEvent) => {
    event.preventDefault();
    commit(false);
  };

  const commit = (push: boolean) => {
    const message = commitMessage().trim();
    if (!message) return;
    send(push ? "commit_and_push" : "commit", {
      message,
      ...(push ? pushPayload() : {})
    });
    setCommitMessage("");
  };

  const hasCommittableChanges = () =>
    props.repository.staged.length > 0 ||
    props.repository.unstaged.length > 0 ||
    props.repository.untracked.length > 0;
  const canUndoLastCommit = () =>
    !props.repository.unborn && !props.repository.detached && props.repository.commits.length > 0;

  const createBranch = (event: SubmitEvent) => {
    event.preventDefault();
    if (!newBranch().trim()) return;
    send("create_branch", { name: newBranch().trim() });
    setNewBranch("");
  };

  const createStash = (event: SubmitEvent) => {
    event.preventDefault();
    send("create_stash", {
      message: stashMessage().trim(),
      include_untracked: includeUntracked()
    });
    setStashMessage("");
    setIncludeUntracked(false);
  };

  const runCommand = (event: SubmitEvent) => {
    event.preventDefault();
    const value = command().trim();
    if (!value) return;
    send("run_command", { command: value });
    setCommand("");
  };

  const closeRepository = () => {
    if (commandRunning()) {
      const name = props.repository.name;
      if (!window.confirm(`A command is still running in ${name}. Close this repository anyway?`)) {
        return;
      }
    }
    props.send("remove_repository", { id: props.repository.id });
  };

  createEffect(() => {
    const hasActivity = terminal().running || Boolean(terminal().output);
    if (hasActivity) setCommandsOpen(true);
  });

  createEffect(() => {
    terminal().output;
    if (terminalOutput) terminalOutput.scrollTop = terminalOutput.scrollHeight;
  });

  const startPanelResize = (event: PointerEvent) => {
    if (!historyOpen()) return;
    event.preventDefault();

    const target = event.currentTarget as HTMLElement | null;
    const column = target?.closest(".repository-column") as HTMLElement | null;
    const maxHeight = Math.max(180, (column?.clientHeight || 620) - 230);
    const startY = event.clientY;
    const startHeight = bottomPanelHeight();

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    const resize = (moveEvent: PointerEvent) => {
      const next = clamp(startHeight - (moveEvent.clientY - startY), 128, maxHeight);
      setBottomPanelHeight(next);
    };

    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  return (
    <article class="repository-column" ref={props.onColumnRef}>
      <header class="repository-header">
        <div class="repository-title">
          <div>
            <strong title={props.repository.path}>{props.repository.name}</strong>
            <span title={props.repository.path}>{props.repository.path}</span>
          </div>
        </div>
        <div class="repository-actions">
          <button
            type="button"
            class="icon-button"
            aria-label={`Refresh ${props.repository.name}`}
            title="Refresh"
            disabled={gitBusy()}
            onClick={() => send("refresh_repository")}
          >
            &#8635;
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label={`Close ${props.repository.name}`}
            title={
              gitBusy()
                ? "Wait for the current git operation before closing"
                : commandRunning()
                  ? "A command is running — close will confirm first"
                  : "Close repository"
            }
            disabled={gitBusy()}
            onClick={closeRepository}
          >
            x
          </button>
        </div>
      </header>

      <div class="repository-main">
        <section class="branch-summary">
          <div>
            <span class="branch-icon">branch</span>
            <strong>{props.repository.head || "No commits yet"}</strong>
          </div>
          <div class="tracking">
            <Show when={props.repository.ahead > 0}><span>ahead {props.repository.ahead}</span></Show>
            <Show when={props.repository.behind > 0}><span>behind {props.repository.behind}</span></Show>
            <Show when={props.repository.upstream}><span>{props.repository.upstream}</span></Show>
          </div>
        </section>

        <Show when={props.repository.busy}>
          <div class="operation-progress">
            <span class="spinner" />
            {humanize(props.repository.busy || "")}
          </div>
        </Show>

        <Show when={props.repository.last_error}>
          <div class="repository-error">{props.repository.last_error}</div>
        </Show>

        <Show when={props.repository.last_notice}>
          <div class="repository-notice">{props.repository.last_notice}</div>
        </Show>

        <Show when={props.repository.operation_state}>
          <section class="conflict-banner">
            <strong>{humanize(props.repository.operation_state || "")} in progress</strong>
            <span>Resolve files externally, stage them here, then continue.</span>
            <div class="button-row">
              <button disabled={gitBusy()} type="button" onClick={() => send("continue_operation")}>Continue</button>
              <button
                disabled={gitBusy()}
                type="button"
                class="danger"
                onClick={() => {
                  if (window.confirm(`Abort the ${props.repository.operation_state}? Resolved and staged conflict work may be discarded.`)) {
                    send("abort_operation", { confirmed: true });
                  }
                }}
              >Abort</button>
            </div>
          </section>
        </Show>

        <details
          class="terminal-panel"
          open={commandsOpen()}
          onToggle={(event) => {
            if (terminal().running && !event.currentTarget.open) {
              event.currentTarget.open = true;
              return;
            }
            setCommandsOpen(event.currentTarget.open);
          }}
        >
          <summary>
            <strong>Commands</strong>
            <span>{terminal().running ? terminal().command : terminal().exit_status == null ? "idle" : `exit ${terminal().exit_status}`}</span>
          </summary>
          <Show when={commandsOpen()}>
            <div class="terminal-content">
              <p class="terminal-trust-note">Commands run locally with your user account and can modify files outside this repository.</p>
              <form class="terminal-form" onSubmit={runCommand}>
                <input
                  aria-label="Command"
                  list={`commands-${props.repository.id}`}
                  placeholder="bun run dev"
                  value={command()}
                  disabled={commandRunning()}
                  onInput={(event) => setCommand(event.currentTarget.value)}
                />
                <datalist id={`commands-${props.repository.id}`}>
                  <option value="bun run dev" />
                  <option value="bun run build" />
                  <option value="mix phx.server" />
                  <option value="bun run tauri:dev" />
                </datalist>
                <Show
                  when={commandRunning()}
                  fallback={
                    <div class="terminal-actions">
                      <Show when={terminal().port_conflict?.replaceable}>
                        <button type="button" class="danger" onClick={() => send("replace_port_command")}>Replace Port</button>
                      </Show>
                      <button type="submit" disabled={!command().trim() || commandRunning()}>Run</button>
                    </div>
                  }
                >
                  <button type="button" class="danger" onClick={() => send("stop_command")}>Stop</button>
                </Show>
              </form>
              <pre
                class="terminal-output"
                ref={(element) => {
                  terminalOutput = element;
                  onCleanup(() => {
                    if (terminalOutput === element) terminalOutput = undefined;
                  });
                }}
              >{terminal().output || "No command output yet."}</pre>
            </div>
          </Show>
        </details>

        <section class="changes-panel">
          <header class="changes-header">
            <strong>Changes</strong>
            <span>
              {props.repository.staged.length +
                props.repository.unstaged.length +
                props.repository.untracked.length +
                props.repository.conflicted.length}
            </span>
          </header>

          <Show when={props.repository.conflicted.length > 0}>
            <FileGroup
              title="Conflicts"
              tone="conflict"
              files={props.repository.conflicted}
              emptyText=""
              busy={gitBusy()}
              onDiff={(file) => props.onDiff(file, false)}
              primaryAction="Stage"
              onPrimary={(file) => send("stage", { path: file.path })}
            />
          </Show>

          <FileGroup
            title="Unstaged"
            files={props.repository.unstaged}
            emptyText="Working tree clean"
            busy={gitBusy()}
            onDiff={(file) => props.onDiff(file, false)}
            primaryAction="Stage"
            onPrimary={(file) => send("stage", { path: file.path })}
            secondaryAction="Discard"
            onSecondary={(file) => {
              if (window.confirm(`Discard changes to "${file.path}"?`)) {
                send("discard", { path: file.path, untracked: false, confirmed: true });
              }
            }}
            groupAction={props.repository.unstaged.length || props.repository.untracked.length ? "Stage all" : undefined}
            onGroupAction={() => send("stage_all")}
          />

          <FileGroup
            title="Staged"
            tone="staged"
            files={props.repository.staged}
            emptyText="No staged changes"
            busy={gitBusy()}
            onDiff={(file) => props.onDiff(file, true)}
            primaryAction="Unstage"
            onPrimary={(file) => send("unstage", { path: file.path })}
            groupAction={props.repository.staged.length ? "Unstage all" : undefined}
            onGroupAction={() => send("unstage_all")}
          />

          <Show when={props.repository.untracked.length > 0}>
            <FileGroup
              title="Untracked"
              files={props.repository.untracked}
              emptyText=""
              busy={gitBusy()}
              onDiff={(file) => props.onDiff(file, false)}
              primaryAction="Stage"
              onPrimary={(file) => send("stage", { path: file.path })}
              secondaryAction="Delete"
              onSecondary={(file) => {
                if (window.confirm(`Permanently delete untracked path "${file.path}"?`)) {
                  send("discard", { path: file.path, untracked: true, confirmed: true });
                }
              }}
            />
          </Show>
        </section>

        <details
          class="management-panel advanced-panel"
          open={advancedOpen()}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setAdvancedOpen(open);
            if (open && !gitBusy()) send("refresh_repository");
          }}
        >
          <summary>
            Advanced
            <span>{props.repository.remotes.length} remotes / {props.repository.stashes.length} stashes</span>
          </summary>
          <Show when={advancedOpen()}>
            <div class="management-content advanced-content">
            <section class="advanced-section remote-controls">
              <h3>Remote operations</h3>
              <div class="field-row">
                <select
                  aria-label="Remote"
                  value={remote()}
                  onChange={(event) => {
                    setRemote(event.currentTarget.value);
                    setRemoteBranch("");
                  }}
                >
                  <option value="">Remote: {props.repository.remote || props.repository.remotes[0] || "select"}</option>
                  <For each={props.repository.remotes}>{(item) => <option value={item}>{item}</option>}</For>
                </select>
                <select
                  aria-label="Remote branch"
                  value={remoteBranch()}
                  onChange={(event) => setRemoteBranch(event.currentTarget.value)}
                >
                  <option value="">Branch: select</option>
                  <For each={remoteBranches()}>{(branch) => <option value={branch.name}>{branch.name}</option>}</For>
                </select>
              </div>
              <div class="button-row remote-buttons">
                <button disabled={gitBusy()} type="button" onClick={() => send("fetch", { remote: selectedRemote() })}>Fetch</button>
                <button
                  disabled={gitBusy() || !canPull()}
                  type="button"
                  onClick={() => {
                    const branch = pullBranch();
                    send("pull", branch ? { remote: selectedRemote(), branch } : {});
                  }}
                >
                  Pull
                </button>
                <button
                  disabled={gitBusy() || !canPush()}
                  type="button"
                  title={
                    !remote() && props.repository.upstream
                      ? `Push to ${props.repository.upstream}`
                      : `Publish ${props.repository.head || "branch"} to ${selectedRemote() || "the selected remote"}`
                  }
                  onClick={() => send("push", pushPayload())}
                >
                  {pushLabel()}
                </button>
                <button disabled={gitBusy()} type="button" title="Fetch all remotes" onClick={() => send("fetch", { all: true })}>All</button>
              </div>
            </section>

            <section class="advanced-section">
              <h3>Branches</h3>
              <p class="advanced-meta">{localBranches().length} local / {remoteBranches().length} remote</p>
            <div class="field-row">
              <select
                aria-label="Local branch"
                value={selectedBranch()}
                onChange={(event) => setSelectedBranch(event.currentTarget.value)}
              >
                <option value="">Select local branch</option>
                <For each={localBranches()}>
                  {(branch) => <option value={branch.name}>{branch.current ? "* " : ""}{branch.name}</option>}
                </For>
              </select>
              <button disabled={gitBusy() || !selectedBranch()} type="button" onClick={() => send("checkout_branch", { name: selectedBranch() })}>Switch</button>
            </div>

            <form class="field-row" onSubmit={createBranch}>
              <input
                aria-label="New branch"
                placeholder="New branch name"
                value={newBranch()}
                onInput={(event) => setNewBranch(event.currentTarget.value)}
              />
              <button disabled={gitBusy()} type="submit">Create</button>
            </form>

            <div class="button-row">
              <button
                disabled={gitBusy() || !selectedBranch()}
                type="button"
                onClick={() => {
                  const value = window.prompt("Rename branch to:", selectedBranch());
                  if (value?.trim()) send("rename_branch", { old: selectedBranch(), new: value.trim() });
                }}
              >
                Rename
              </button>
              <button
                disabled={gitBusy() || !selectedBranch() || selectedBranch() === props.repository.head}
                type="button"
                class="danger"
                onClick={() => {
                  if (window.confirm(`Delete branch "${selectedBranch()}"? Git will refuse if it is not fully merged.`)) {
                    send("delete_branch", { name: selectedBranch(), confirmed: true });
                  }
                }}
              >
                Delete
              </button>
              <button
                disabled={gitBusy() || !canSetUpstream()}
                type="button"
                onClick={() => send("set_upstream", { upstream: selectedRemoteBranch(), local: props.repository.head })}
              >
                Set upstream
              </button>
            </div>

            <div class="field-row">
              <input
                aria-label="Tracking branch name"
                placeholder="Local tracking branch"
                value={trackingLocal()}
                onInput={(event) => setTrackingLocal(event.currentTarget.value)}
              />
              <button
                disabled={gitBusy() || !pullBranch()}
                type="button"
                onClick={() =>
                  send("track_branch", {
                    remote_branch: selectedRemoteBranch(),
                    local: trackingLocal().trim() || pullBranch()
                  })
                }
              >
                Track
              </button>
            </div>
            </section>

            <section class="advanced-section">
              <h3>Commits</h3>
              <div class="button-row">
                <button
                  disabled={gitBusy() || !canUndoLastCommit()}
                  type="button"
                  class="danger"
                  onClick={() => {
                    if (window.confirm("Undo the last commit? This will create a new commit that reverses its changes.")) {
                      send("undo_last_commit", { confirmed: true });
                    }
                  }}
                >
                  Undo last commit
                </button>
              </div>
            </section>

            <section class="advanced-section">
              <h3>Stashes</h3>
            <form class="stash-form" onSubmit={createStash}>
              <input
                aria-label="Stash message"
                placeholder="Optional stash message"
                value={stashMessage()}
                onInput={(event) => setStashMessage(event.currentTarget.value)}
              />
              <label>
                <input
                  type="checkbox"
                  checked={includeUntracked()}
                  onChange={(event) => setIncludeUntracked(event.currentTarget.checked)}
                />
                Include untracked
              </label>
              <button disabled={gitBusy()} type="submit">Create stash</button>
            </form>
            <For each={props.repository.stashes}>
              {(stash) => (
                <div class="stash-row">
                  <div>
                    <strong>{stash.ref}</strong>
                    <span>{stash.message}</span>
                  </div>
                  <div class="button-row">
                    <button disabled={gitBusy()} type="button" onClick={() => send("apply_stash", { ref: stash.ref })}>Apply</button>
                    <button disabled={gitBusy()} type="button" onClick={() => send("pop_stash", { ref: stash.ref })}>Pop</button>
                    <button
                      disabled={gitBusy()}
                      type="button"
                      class="danger"
                      onClick={() => {
                        if (window.confirm(`Drop ${stash.ref}?`)) {
                          send("drop_stash", { ref: stash.ref, confirmed: true });
                        }
                      }}
                    >
                      Drop
                    </button>
                  </div>
                </div>
              )}
            </For>
            </section>
            </div>
          </Show>
        </details>
      </div>

      <form class="commit-form" onSubmit={submitCommit}>
        <textarea
          aria-label="Commit message"
          rows={2}
          placeholder="Commit message"
          value={commitMessage()}
          onInput={(event) => setCommitMessage(event.currentTarget.value)}
        />
        <div>
          <span>{props.repository.staged.length} staged</span>
          <div class="commit-actions">
            <button
              disabled={gitBusy() || !hasCommittableChanges() || props.repository.conflicted.length > 0 || !commitMessage().trim()}
              type="submit"
            >
              Commit
            </button>
            <button
              disabled={gitBusy() || !hasCommittableChanges() || props.repository.conflicted.length > 0 || !commitMessage().trim()}
              type="button"
              onClick={() => commit(true)}
            >
              Commit &amp; Push
            </button>
          </div>
        </div>
      </form>

      <section
        class={historyOpen() ? "history-panel open" : "history-panel"}
        style={historyOpen() ? `flex-basis: ${bottomPanelHeight()}px` : ""}
      >
        <Show when={historyOpen()}>
          <div
            class="history-resize-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize history and files panel"
            onPointerDown={startPanelResize}
          />
        </Show>
        <div class="history-summary">
          <button
            type="button"
            class="panel-toggle"
            aria-expanded={historyOpen() ? "true" : "false"}
            onClick={() => {
              const next = !historyOpen();
              if (!next && bottomTab() === "files") props.onReleaseFileBrowser();
              if (next && bottomTab() === "files" && props.fileTree.length === 0) {
                props.onRequestFileTree();
              }
              setHistoryOpen(next);
            }}
          />
          <div class="panel-tabs" role="tablist" aria-label={`${props.repository.name} lower panel`}>
            <button
              type="button"
              class={bottomTab() === "history" ? "active" : ""}
              role="tab"
              aria-selected={bottomTab() === "history" ? "true" : "false"}
              onClick={() => {
                if (bottomTab() === "files") props.onReleaseFileBrowser();
                setBottomTab("history");
                setHistoryOpen(true);
              }}
            >
              History
              <span>{props.repository.commits.length}</span>
            </button>
            <button
              type="button"
              class={bottomTab() === "files" ? "active" : ""}
              role="tab"
              aria-selected={bottomTab() === "files" ? "true" : "false"}
              onClick={() => {
                setBottomTab("files");
                setHistoryOpen(true);
                if (props.fileTree.length === 0) props.onRequestFileTree();
              }}
            >
              Files
              <span>{props.fileTree.length}</span>
            </button>
          </div>
        </div>
        <Show when={historyOpen()}>
          <Show
            when={bottomTab() === "history"}
            fallback={
              <FileBrowser
                files={props.fileTree}
                fileSearch={props.fileSearch}
                selectedPath={props.activeFilePath}
                onRefresh={props.onRequestFileTree}
                onSearchContents={props.onSearchFileContents}
                onOpenExternal={props.onOpenExternalFile}
                onOpenInCursor={props.onOpenInCursor}
                onOpen={props.onOpenFile}
                onCreateFile={props.onCreateFile}
              />
            }
          >
            <CommitHistory
              commits={props.repository.commits}
              currentOid={props.repository.oid}
              selectedOid={selectedCommit()}
              busy={gitBusy()}
              onSelect={setSelectedCommit}
              onCheckout={(commitItem) => {
                if (
                  window.confirm(
                    `Check out ${commitItem.short_oid} "${commitItem.subject}"?\n\nThis will detach HEAD from the current branch.`
                  )
                ) {
                  send("checkout_commit", { oid: commitItem.oid, confirmed: true });
                }
              }}
            />
          </Show>
        </Show>
      </section>
    </article>
  );
}
