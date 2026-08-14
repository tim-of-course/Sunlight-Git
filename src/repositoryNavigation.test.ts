import { describe, expect, it } from "vitest";
import {
  findRepositorySearchMatch,
  repositoryChangeCount,
  repositoryScrollLeft,
  repositoryShortName,
  repositoryVisibility
} from "./repositoryNavigation";
import type { GitFile, Repository } from "./types";

const file = (path: string): GitFile => ({ path, kind: "modified" });

function repository(
  id: string,
  name: string,
  path = `C:/repos/${name}`
): Repository {
  return {
    id,
    name,
    path,
    unborn: false,
    detached: false,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
    branches: [],
    remotes: [],
    stashes: [],
    commits: []
  };
}

describe("repositoryChangeCount", () => {
  it("counts every uncommitted file bucket", () => {
    const repo = repository("sun", "sunlight");
    repo.staged = [file("one")];
    repo.unstaged = [file("two"), file("three")];
    repo.untracked = [file("four")];
    repo.conflicted = [file("five")];

    expect(repositoryChangeCount(repo)).toBe(5);
  });
});

describe("repositoryShortName", () => {
  it("uses the first six visible characters by default", () => {
    expect(repositoryShortName("sunlight-ui")).toBe("sunlig");
  });
});

describe("findRepositorySearchMatch", () => {
  it("returns the first repository with a matching name", () => {
    const repos = [
      repository("one", "api", "C:/work/search-target"),
      repository("two", "search-app")
    ];

    expect(findRepositorySearchMatch(repos, "search")).toBe("two");
  });

  it("falls back to path matching when no names match", () => {
    const repos = [
      repository("one", "api", "C:/work/search-target"),
      repository("two", "web")
    ];

    expect(findRepositorySearchMatch(repos, "target")).toBe("one");
  });

  it("does not match an empty query", () => {
    expect(findRepositorySearchMatch([repository("one", "api")], " ")).toBeNull();
  });
});

describe("repositoryVisibility", () => {
  it("marks visible repositories and chooses the widest one as primary", () => {
    const visibility = repositoryVisibility(
      { left: 100, right: 500 },
      [
        { id: "off-left", rect: { left: 0, right: 80 } },
        { id: "partial-left", rect: { left: 50, right: 250 } },
        { id: "center", rect: { left: 260, right: 470 } },
        { id: "partial-right", rect: { left: 480, right: 650 } }
      ]
    );

    expect(visibility.visibleIds).toEqual(["partial-left", "center", "partial-right"]);
    expect(visibility.primaryId).toBe("center");
  });
});

describe("repositoryScrollLeft", () => {
  it("keeps the first repository at the start of the workspace", () => {
    expect(
      repositoryScrollLeft({
        workspaceScrollLeft: 300,
        workspaceLeft: 72,
        targetLeft: -218,
        targetIndex: 0,
        gap: 10,
        maxScrollLeft: 1000
      })
    ).toBe(10);
  });

  it("leaves one inter-column gap before non-first targets", () => {
    expect(
      repositoryScrollLeft({
        workspaceScrollLeft: 0,
        workspaceLeft: 72,
        targetLeft: 482,
        targetIndex: 1,
        gap: 10,
        maxScrollLeft: 1000
      })
    ).toBe(400);
  });

  it("clamps to the available scroll range", () => {
    expect(
      repositoryScrollLeft({
        workspaceScrollLeft: 900,
        workspaceLeft: 72,
        targetLeft: 900,
        targetIndex: 3,
        gap: 10,
        maxScrollLeft: 1000
      })
    ).toBe(1000);
  });
});
