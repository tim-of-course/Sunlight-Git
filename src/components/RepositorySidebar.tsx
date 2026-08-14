import { Show, createMemo, createSignal, onCleanup } from "solid-js";
import { Key } from "@solid-primitives/keyed";
import type { Repository } from "../types";
import {
  findRepositorySearchMatch,
  repositoryChangeCount,
  repositoryShortName
} from "../repositoryNavigation";
import { moveRepositoryToIndex, reorderIndexFromPointer } from "../workspaceOrder";

const DRAG_THRESHOLD = 6;

export function RepositorySidebar(props: {
  repositories: Repository[];
  visibleRepositoryIds: string[];
  primaryRepositoryId: string | null;
  onSelectRepository: (id: string) => void;
  onReorderRepositories: (ids: string[]) => void;
}) {
  const [query, setQuery] = createSignal("");
  const [forceCollapsed, setForceCollapsed] = createSignal(false);
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [orderedIds, setOrderedIds] = createSignal<string[] | null>(null);
  const visibleIds = createMemo(() => new Set(props.visibleRepositoryIds));
  const searchMatchId = createMemo(() => findRepositorySearchMatch(props.repositories, query()));
  const displayedRepositories = createMemo(() => {
    const order = orderedIds();
    if (!order) return props.repositories;
    const byId = new Map(props.repositories.map((repository) => [repository.id, repository]));
    return order.flatMap((id) => {
      const repository = byId.get(id);
      return repository ? [repository] : [];
    });
  });
  let pointerSelecting = false;
  let didDrag = false;
  let tabsElement: HTMLElement | undefined;
  let dragSession: {
    pointerId: number;
    sourceId: string;
    startY: number;
    origin: string[];
    order: string[];
    started: boolean;
    previousCursor: string;
    previousUserSelect: string;
  } | null = null;

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
    if (didDrag) {
      didDrag = false;
      pointerSelecting = false;
      return;
    }

    const collapseAfterSelect = pointerSelecting;
    pointerSelecting = false;
    props.onSelectRepository(id);

    if (collapseAfterSelect) {
      setForceCollapsed(true);
      event.currentTarget instanceof HTMLElement && event.currentTarget.blur();
    }
  };

  const tabRects = () =>
    tabsElement
      ? Array.from(tabsElement.querySelectorAll<HTMLElement>(".repository-tab")).map((tab) => {
          const rect = tab.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        })
      : [];

  const autoScrollTabs = (clientY: number) => {
    if (!tabsElement) return;
    const rect = tabsElement.getBoundingClientRect();
    const edge = 28;
    if (clientY < rect.top + edge) {
      tabsElement.scrollTop -= 12;
    } else if (clientY > rect.bottom - edge) {
      tabsElement.scrollTop += 12;
    }
  };

  const stopDrag = (commit: boolean) => {
    const session = dragSession;
    dragSession = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    document.body.style.cursor = session?.previousCursor || "";
    document.body.style.userSelect = session?.previousUserSelect || "";
    setDraggingId(null);
    setOrderedIds(null);

    if (!session || !commit || !session.started) return;
    const unchanged = session.order.length === session.origin.length
      && session.order.every((id, index) => id === session.origin[index]);
    if (!unchanged) props.onReorderRepositories(session.order);
  };

  const onPointerMove = (event: PointerEvent) => {
    const session = dragSession;
    if (!session || event.pointerId !== session.pointerId) return;

    if (!session.started) {
      if (Math.abs(event.clientY - session.startY) < DRAG_THRESHOLD) return;
      session.started = true;
      didDrag = true;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      setDraggingId(session.sourceId);
      setOrderedIds(session.order);
    }

    event.preventDefault();
    autoScrollTabs(event.clientY);
    const next = moveRepositoryToIndex(
      session.order,
      session.sourceId,
      reorderIndexFromPointer(event.clientY, tabRects())
    );
    if (next === session.order) return;
    session.order = next;
    setOrderedIds(next);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    stopDrag(true);
    window.setTimeout(() => {
      didDrag = false;
    }, 0);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;
    stopDrag(false);
    didDrag = false;
  };

  const startPotentialDrag = (id: string, event: PointerEvent) => {
    if (event.button !== 0 || dragSession) return;
    pointerSelecting = true;
    dragSession = {
      pointerId: event.pointerId,
      sourceId: id,
      startY: event.clientY,
      origin: props.repositories.map((repository) => repository.id),
      order: props.repositories.map((repository) => repository.id),
      started: false,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  onCleanup(() => stopDrag(false));

  return (
    <aside
      class={
        draggingId()
          ? "repository-sidebar is-reordering"
          : forceCollapsed()
            ? "repository-sidebar force-collapsed"
            : "repository-sidebar"
      }
      aria-label="Repository navigation"
      onFocusIn={() => setForceCollapsed(false)}
      onPointerLeave={() => {
        if (!draggingId()) setForceCollapsed(false);
      }}
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
      <nav
        class="repository-tabs"
        aria-label="Open repositories"
        ref={(element) => {
          tabsElement = element;
        }}
      >
        <Key each={displayedRepositories()} by={(repository) => repository.id}>
          {(repository) => {
            const changes = () => repositoryChangeCount(repository());
            const commandRunning = () => Boolean(repository().terminal?.running);
            const visible = () => visibleIds().has(repository().id);
            const primary = () => props.primaryRepositoryId === repository().id;
            const searchMatch = () => searchMatchId() === repository().id;
            const statusLabel = () => {
              const parts = [`${changes()} uncommitted changes`];
              if (commandRunning()) parts.push("command running");
              return parts.join(", ");
            };

            return (
              <button
                type="button"
                class={`repository-tab${visible() ? " in-view" : ""}${primary() ? " primary" : ""}${searchMatch() ? " search-match" : ""}${draggingId() === repository().id ? " dragging" : ""}`}
                aria-current={primary() ? "true" : undefined}
                aria-label={`${repository().name}, ${statusLabel()}`}
                title={repository().path}
                onPointerDown={(event) => startPotentialDrag(repository().id, event)}
                onClick={(event) => selectRepository(repository().id, event)}
              >
                <span class="repository-tab-label">
                  <span class="repository-tab-short" aria-hidden="true">
                    {repositoryShortName(repository().name)}
                  </span>
                  <span class="repository-tab-full">{repository().name}</span>
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
        </Key>
      </nav>
    </aside>
  );
}
