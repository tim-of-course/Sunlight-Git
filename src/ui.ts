export type Send = (event: string, payload?: Record<string, unknown>) => void;

export function fileKey(id: string, path: string) {
  return `${id}:${path}`;
}

export function fileBasename(path: string) {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export const graphColors = ["#e2ae4c", "#6fb6e8", "#b58be2", "#70c99a", "#e77f91", "#d78c5d"];
const relativeDateFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function displayRef(ref: string) {
  return ref.replace(/^HEAD -> /, "").replace(/^tag: /, "");
}

export function refTone(ref: string) {
  if (ref.startsWith("tag: ")) return "tag";
  if (ref.includes("/") && !ref.startsWith("HEAD -> ")) return "remote";
  return "branch";
}

export function splitDiffLines(content: string) {
  if (!content) return [];
  return content.replace(/\n$/, "").split("\n");
}

export function diffLineTone(line: string) {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "meta";
  if (line.startsWith("+++") || line.startsWith("---")) return "file-meta";
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatCommitDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function relativeCommitDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60]
  ];

  for (const [unit, size] of ranges) {
    if (Math.abs(seconds) >= size) {
      return relativeDateFormatter.format(Math.round(seconds / size), unit);
    }
  }

  return "just now";
}

export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}
