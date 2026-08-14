import { For, Show, createMemo, createSignal } from "solid-js";
import type { Repository } from "../types";
import {
  findRepositorySearchMatch,
  repositoryChangeCount,
  repositoryShortName
} from "../repositoryNavigation";

export function RepositorySidebar(props: {
  repositories: Repository[];
  visibleRepositoryIds: string[];
  primaryRepositoryId: string | null;
  onSelectRepository: (id: string) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [forceCollapsed, setForceCollapsed] = createSignal(false);
  const visibleIds = createMemo(() => new Set(props.visibleRepositoryIds));
  const searchMatchId = createMemo(() => findRepositorySearchMatch(props.repositories, query()));
  let pointerSelecting = false;

  const handleSearchKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const id = searchMatchId();
      if (id) props.onSelectRepository(id);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
    }
  };

  const selectRepository = (id: string, event: MouseEvent) => {
    const collapseAfterSelect = pointerSelecting;
    pointerSelecting = false;
    props.onSelectRepository(id);

    if (collapseAfterSelect) {
      setForceCollapsed(true);
      event.currentTarget instanceof HTMLElement && event.currentTarget.blur();
    }
  };

  return (
    <aside
      class={forceCollapsed() ? "repository-sidebar force-collapsed" : "repository-sidebar"}
      aria-label="Repository navigation"
      onFocusIn={() => setForceCollapsed(false)}
      onPointerLeave={() => setForceCollapsed(false)}
    >
      <div class="repository-sidebar-search">
        <input
          aria-label="Search repositories"
          placeholder="Find"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleSearchKeyDown}
        />
      </div>
      <nav class="repository-tabs" aria-label="Open repositories">
        <For each={props.repositories}>
          {(repository) => {
            const changes = () => repositoryChangeCount(repository);
            const commandRunning = () => Boolean(repository.terminal?.running);
            const visible = () => visibleIds().has(repository.id);
            const primary = () => props.primaryRepositoryId === repository.id;
            const searchMatch = () => searchMatchId() === repository.id;
            const statusLabel = () => {
              const parts = [`${changes()} uncommitted changes`];
              if (commandRunning()) parts.push("command running");
              return parts.join(", ");
            };

            return (
              <button
                type="button"
                class={`repository-tab${visible() ? " in-view" : ""}${primary() ? " primary" : ""}${searchMatch() ? " search-match" : ""}`}
                aria-current={primary() ? "true" : undefined}
                aria-label={`${repository.name}, ${statusLabel()}`}
                title={repository.path}
                onPointerDown={() => {
                  pointerSelecting = true;
                }}
                onClick={(event) => selectRepository(repository.id, event)}
              >
                <span class="repository-tab-label">
                  <span class="repository-tab-short" aria-hidden="true">
                    {repositoryShortName(repository.name)}
                  </span>
                  <span class="repository-tab-full">{repository.name}</span>
                </span>
                <span class="repository-tab-status" aria-hidden="true">
                  <Show when={changes() > 0}>
                    <span class="repository-tab-count">{changes()}</span>
                  </Show>
                  <Show when={commandRunning()}>
                    <span class="repository-tab-command">Run</span>
                  </Show>
                </span>
              </button>
            );
          }}
        </For>
      </nav>
    </aside>
  );
}
