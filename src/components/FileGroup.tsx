import { For, Show } from "solid-js";
import type { GitFile } from "../types";

export function FileGroup(props: {
  title: string;
  tone?: "staged" | "conflict";
  files: GitFile[];
  emptyText: string;
  busy: boolean;
  primaryAction: string;
  secondaryAction?: string;
  groupAction?: string;
  onDiff: (file: GitFile) => void;
  onPrimary: (file: GitFile) => void;
  onSecondary?: (file: GitFile) => void;
  onGroupAction?: () => void;
}) {
  return (
    <section class={`file-group ${props.tone || ""}`}>
      <header>
        <div>
          <strong>{props.title}</strong>
          <span>{props.files.length}</span>
        </div>
        <Show when={props.groupAction}>
          <button disabled={props.busy} type="button" onClick={props.onGroupAction}>
            {props.groupAction}
          </button>
        </Show>
      </header>
      <Show when={props.files.length > 0} fallback={<p class="empty-group">{props.emptyText}</p>}>
        <For each={props.files}>
          {(file) => (
            <div class="file-row">
              <button type="button" class="file-name" title={file.path} onClick={() => props.onDiff(file)}>
                <StatusMark file={file} />
                <span>{file.path}</span>
              </button>
              <div class="file-actions">
                <button disabled={props.busy} type="button" onClick={() => props.onPrimary(file)}>
                  {props.primaryAction}
                </button>
                <Show when={props.secondaryAction && props.onSecondary}>
                  <button disabled={props.busy} type="button" class="danger" onClick={() => props.onSecondary?.(file)}>
                    {props.secondaryAction}
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </Show>
    </section>
  );
}

function StatusMark(props: { file: GitFile }) {
  const mark = () => {
    if (props.file.kind === "untracked") return "U";
    if (props.file.kind === "conflicted") return "!";
    if (props.file.kind === "renamed") return "R";
    if (props.file.kind === "deleted") return "D";
    if (props.file.kind === "added") return "A";
    return "M";
  };

  return <span class={`status-mark ${props.file.kind}`}>{mark()}</span>;
}
