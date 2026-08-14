export type FileTreeNode = {
  name: string;
  path: string;
  kind: "directory" | "file";
  children: FileTreeNode[];
};

export type HighlightSegment = {
  text: string;
  match: boolean;
};

export const directoryDefaultExpanded = false;

export function filterFilePaths(
  files: string[],
  nameQuery: string,
  contentQuery: string,
  contentMatches: string[] | null
) {
  const normalizedName = normalizeQuery(nameQuery);
  const normalizedContent = normalizeQuery(contentQuery);
  const contentMatchSet = normalizedContent ? new Set(contentMatches || []) : null;

  return files.filter((file) => {
    if (normalizedName && !file.toLowerCase().includes(normalizedName)) return false;
    if (contentMatchSet && !contentMatchSet.has(file)) return false;
    return true;
  });
}

export function buildFileTree(files: string[]) {
  const root: FileTreeNode = { name: "", path: "", kind: "directory", children: [] };

  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    let current = root;

    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join("/");
      const kind = index === parts.length - 1 ? "file" : "directory";
      let child = current.children.find((node) => node.name === part && node.kind === kind);

      if (!child) {
        child = { name: part, path, kind, children: [] };
        current.children.push(child);
      }

      current = child;
    }
  }

  sortFileTree(root.children);
  return root.children;
}

export function splitHighlightedText(
  content: string,
  query: string,
  maxMatches = Number.POSITIVE_INFINITY
): HighlightSegment[] {
  const needle = normalizeQuery(query);
  if (!needle) return [{ text: content || " ", match: false }];

  const lowerContent = content.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let matches = 0;

  while (cursor < content.length) {
    if (matches >= maxMatches) {
      segments.push({ text: content.slice(cursor), match: false });
      break;
    }
    const index = lowerContent.indexOf(needle, cursor);

    if (index === -1) {
      segments.push({ text: content.slice(cursor), match: false });
      break;
    }

    if (index > cursor) {
      segments.push({ text: content.slice(cursor, index), match: false });
    }

    const end = index + needle.length;
    segments.push({ text: content.slice(index, end), match: true });
    matches += 1;
    cursor = end;
  }

  return segments.length > 0 ? segments : [{ text: content || " ", match: false }];
}

function sortFileTree(nodes: FileTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const node of nodes) sortFileTree(node.children);
}

function normalizeQuery(query: string) {
  return query.trim().toLowerCase();
}
