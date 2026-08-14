import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { splitHighlightedText } from "../fileBrowser";
import type { FileContentResult } from "../types";
import { formatBytes } from "../ui";

const maxEditorHighlightContentLength = 200_000;
const maxEditorHighlightMatches = 500;

export function EditorDrawer(props: {
  file: FileContentResult | null;
  initialContent: string;
  resetKey: number;
  searchQuery: string;
  dirty: boolean;
  onChange: (content: string) => void;
  onOpenExternal: () => void;
  onOpenInCursor: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  let textarea: HTMLTextAreaElement | undefined;
  let highlightLayer: HTMLPreElement | undefined;
  let highlightFrame: number | null = null;
  let pendingHighlightContent = "";
  const [highlightContent, setHighlightContent] = createSignal("");
  const hasSearchHighlight = () => Boolean(props.searchQuery.trim());
  const canRenderSearchHighlight = () =>
    hasSearchHighlight() && highlightContent().length <= maxEditorHighlightContentLength;
  const highlightSegments = createMemo(() =>
    canRenderSearchHighlight()
      ? splitHighlightedText(highlightContent(), props.searchQuery, maxEditorHighlightMatches)
      : []
  );
  const syncHighlightScroll = () => {
    if (!textarea || !highlightLayer) return;
    highlightLayer.scrollTop = textarea.scrollTop;
    highlightLayer.scrollLeft = textarea.scrollLeft;
  };
  const queueHighlightRefresh = (content: string) => {
    if (!hasSearchHighlight()) return;
    pendingHighlightContent = content;
    if (highlightFrame !== null) return;

    highlightFrame = window.requestAnimationFrame(() => {
      highlightFrame = null;
      setHighlightContent(pendingHighlightContent);
      syncHighlightScroll();
    });
  };

  createEffect(() => {
    const _reset = props.resetKey;
    const content = props.initialContent;
    void _reset;
    pendingHighlightContent = content;
    if (textarea && textarea.value !== content) textarea.value = content;
    setHighlightContent(content);
    window.requestAnimationFrame(syncHighlightScroll);
  });

  createEffect(() => {
    const query = props.searchQuery.trim();
    if (!query) {
      setHighlightContent("");
      return;
    }

    const content = textarea?.value ?? props.initialContent;
    pendingHighlightContent = content;
    setHighlightContent(content);
    window.requestAnimationFrame(syncHighlightScroll);
  });

  onCleanup(() => {
    if (highlightFrame !== null) window.cancelAnimationFrame(highlightFrame);
  });

  return (
    <Show when={props.file} fallback={<div class="binary-notice">No file selected.</div>}>
      {(file) => (
        <div class="editor-drawer">
          <div class="editor-toolbar">
            <div>
              <strong title={file().path}>{file().path}</strong>
              <span>{formatBytes(file().size)}{props.dirty ? " / unsaved" : ""}</span>
            </div>
            <div class="button-row">
              <button type="button" onClick={props.onOpenExternal}>Open outside</button>
              <button type="button" onClick={props.onOpenInCursor}>Cursor</button>
              <button type="button" disabled={!props.dirty} onClick={props.onSave}>
                Save
              </button>
              <button type="button" onClick={props.onClose}>Close file</button>
            </div>
          </div>
          <div class={canRenderSearchHighlight() ? "editor-text-wrap highlighting" : "editor-text-wrap"}>
            <Show when={canRenderSearchHighlight()}>
              <pre class="editor-highlight-layer" aria-hidden="true" ref={(element) => (highlightLayer = element)}>
                <code>
                  <For each={highlightSegments()}>
                    {(segment) => (
                      <Show when={segment.match} fallback={<span>{segment.text}</span>}>
                        <mark>{segment.text}</mark>
                      </Show>
                    )}
                  </For>
                </code>
              </pre>
            </Show>
            <textarea
              ref={(element) => {
                textarea = element;
                element.value = props.initialContent;
              }}
              aria-label={`Editor for ${file().path}`}
              spellcheck={false}
              onScroll={syncHighlightScroll}
              onInput={(event) => {
                const content = event.currentTarget.value;
                props.onChange(content);
                queueHighlightRefresh(content);
              }}
            />
          </div>
        </div>
      )}
    </Show>
  );
}
