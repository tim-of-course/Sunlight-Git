import { For, Show, createMemo } from "solid-js";
import { diffLineTone, splitDiffLines } from "../ui";

export function DiffViewer(props: { content: string }) {
  const lines = createMemo(() => splitDiffLines(props.content));

  return (
    <pre class="diff-content">
      <Show when={lines().length > 0} fallback={<span class="diff-empty">No textual changes.</span>}>
        <For each={lines()}>
          {(line, index) => (
            <span class={`diff-line ${diffLineTone(line)}`}>
              <span class="diff-gutter">{index() + 1}</span>
              <span class="diff-text">{line || " "}</span>
            </span>
          )}
        </For>
      </Show>
    </pre>
  );
}
