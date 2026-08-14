import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  directoryDefaultExpanded,
  filterFilePaths,
  splitHighlightedText
} from "./fileBrowser";

const files = [
  "src/App.tsx",
  "src/components/Button.tsx",
  "test/App.test.ts",
  "README.md"
];

describe("filterFilePaths", () => {
  it("filters by file name or path", () => {
    expect(filterFilePaths(files, "component", "", null)).toEqual(["src/components/Button.tsx"]);
  });

  it("filters by content search matches", () => {
    expect(filterFilePaths(files, "", "needle", ["src/App.tsx", "README.md"])).toEqual([
      "src/App.tsx",
      "README.md"
    ]);
  });

  it("intersects name filtering with content search matches", () => {
    expect(filterFilePaths(files, "app", "needle", ["src/App.tsx", "README.md"])).toEqual([
      "src/App.tsx"
    ]);
  });
});

describe("buildFileTree", () => {
  it("retains parent folders for matching descendants", () => {
    const tree = buildFileTree(["src/components/Button.tsx"]);

    expect(tree).toEqual([
      {
        name: "src",
        path: "src",
        kind: "directory",
        children: [
          {
            name: "components",
            path: "src/components",
            kind: "directory",
            children: [
              {
                name: "Button.tsx",
                path: "src/components/Button.tsx",
                kind: "file",
                children: []
              }
            ]
          }
        ]
      }
    ]);
  });

  it("defaults directory entries to collapsed", () => {
    expect(directoryDefaultExpanded).toBe(false);
  });
});

describe("splitHighlightedText", () => {
  it("highlights literal case-insensitive matches", () => {
    expect(splitHighlightedText("Alpha alpha ALPHA", "alpha")).toEqual([
      { text: "Alpha", match: true },
      { text: " ", match: false },
      { text: "alpha", match: true },
      { text: " ", match: false },
      { text: "ALPHA", match: true }
    ]);
  });

  it("treats regex-like input as literal text", () => {
    expect(splitHighlightedText("a+b ab a+b", "a+b")).toEqual([
      { text: "a+b", match: true },
      { text: " ab ", match: false },
      { text: "a+b", match: true }
    ]);
  });

  it("caps highlighted matches and leaves the remaining text unhighlighted", () => {
    expect(splitHighlightedText("aaaa", "a", 2)).toEqual([
      { text: "a", match: true },
      { text: "a", match: true },
      { text: "aa", match: false }
    ]);
  });
});
