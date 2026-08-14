import { For, Show, createMemo } from "solid-js";
import { buildCommitGraph, graphLaneCount, type CommitGraphRow } from "../commitGraph";
import type { Commit } from "../types";
import { displayRef, formatCommitDate, graphColors, refTone, relativeCommitDate } from "../ui";

export function CommitHistory(props: {
  commits: Commit[];
  currentOid?: string | null;
  selectedOid: string | null;
  busy: boolean;
  onSelect: (oid: string) => void;
  onCheckout: (commit: Commit) => void;
}) {
  const rows = createMemo(() => buildCommitGraph(props.commits));
  const laneCount = createMemo(() => graphLaneCount(rows()));

  return (
    <div class="history-list">
      <Show when={rows().length > 0} fallback={<p class="history-empty">No commits yet</p>}>
        <For each={rows()}>
          {(row) => {
            const isSelected = () => props.selectedOid === row.commit.oid;
            const isCurrent = () => props.currentOid === row.commit.oid;

            return (
              <div
                class={`commit-row${isSelected() ? " selected" : ""}${isCurrent() ? " current" : ""}`}
                role="button"
                tabindex={0}
                onClick={() => props.onSelect(row.commit.oid)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onSelect(row.commit.oid);
                  }
                }}
                title={`${row.commit.oid}\n${row.commit.author}\n${formatCommitDate(row.commit.authored_at)}`}
              >
                <CommitGraph row={row} laneCount={laneCount()} />
                <div class="commit-copy">
                  <div class="commit-subject">
                    <span>{row.commit.subject}</span>
                    <Show when={row.commit.refs.length > 0}>
                      <span class="commit-refs">
                        <For each={row.commit.refs}>
                          {(ref) => <span class={`commit-ref ${refTone(ref)}`}>{displayRef(ref)}</span>}
                        </For>
                      </span>
                    </Show>
                  </div>
                  <div class="commit-meta">
                    <span>{row.commit.author}</span>
                    <span>{relativeCommitDate(row.commit.authored_at)}</span>
                  </div>
                </div>
                <Show
                  when={isSelected()}
                  fallback={<code class="commit-hash">{row.commit.short_oid}</code>}
                >
                  <button
                    type="button"
                    class="checkout-commit"
                    disabled={props.busy || isCurrent()}
                    title={isCurrent() ? "This commit is already checked out" : "Check out this commit"}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onCheckout(row.commit);
                    }}
                  >
                    {isCurrent() ? "Current" : "Checkout"}
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

function CommitGraph(props: { row: CommitGraphRow; laneCount: number }) {
  const laneX = (lane: number) => 8 + lane * 14;
  const color = (lane: number) => graphColors[lane % graphColors.length];
  const width = () => 16 + (props.laneCount - 1) * 14;

  return (
    <svg
      class="commit-graph"
      width={width()}
      height="46"
      viewBox={`0 0 ${width()} 46`}
      aria-hidden="true"
    >
      <For each={props.row.edges.filter((edge) => edge.kind === "lane")}>
        {(edge) => (
          <path
            d={`M ${laneX(edge.from)} 0 C ${laneX(edge.from)} 23, ${laneX(edge.to)} 23, ${laneX(edge.to)} 46`}
            fill="none"
            stroke={color(edge.from)}
            stroke-width="2"
          />
        )}
      </For>
      <Show when={props.row.incoming}>
        <line
          x1={laneX(props.row.lane)}
          y1="0"
          x2={laneX(props.row.lane)}
          y2="23"
          stroke={color(props.row.lane)}
          stroke-width="2"
        />
      </Show>
      <For each={props.row.edges.filter((edge) => edge.kind === "parent")}>
        {(edge) => (
          <path
            d={`M ${laneX(edge.from)} 23 C ${laneX(edge.from)} 34, ${laneX(edge.to)} 34, ${laneX(edge.to)} 46`}
            fill="none"
            stroke={color(edge.to)}
            stroke-width="2"
          />
        )}
      </For>
      <circle
        cx={laneX(props.row.lane)}
        cy="23"
        r="4"
        fill="#171a21"
        stroke={color(props.row.lane)}
        stroke-width="2.5"
      />
    </svg>
  );
}
