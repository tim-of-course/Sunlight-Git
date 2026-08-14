import { describe, expect, it } from "vitest";
import { buildCommitGraph, graphLaneCount } from "./commitGraph";
import type { Commit } from "./types";

function commit(oid: string, parentOids: string[] = []): Commit {
  return {
    oid,
    short_oid: oid.slice(0, 7),
    parent_oids: parentOids,
    subject: oid,
    author: "Test",
    authored_at: "2026-06-11T10:00:00-05:00",
    refs: []
  };
}

describe("buildCommitGraph", () => {
  it("keeps linear history in one lane", () => {
    const rows = buildCommitGraph([
      commit("c3", ["c2"]),
      commit("c2", ["c1"]),
      commit("c1")
    ]);

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows[0].bottomLanes).toEqual(["c2"]);
    expect(graphLaneCount(rows)).toBe(1);
  });

  it("creates a second lane for a branch and rejoins it at a merge", () => {
    const rows = buildCommitGraph([
      commit("merge", ["main", "feature"]),
      commit("feature", ["base"]),
      commit("main", ["base"]),
      commit("base")
    ]);

    expect(rows[0].bottomLanes).toEqual(["main", "feature"]);
    expect(rows[0].edges.filter((edge) => edge.kind === "parent")).toEqual([
      { from: 0, to: 0, kind: "parent" },
      { from: 0, to: 1, kind: "parent" }
    ]);
    expect(rows[1].lane).toBe(1);
    expect(rows[2].lane).toBe(0);
    expect(graphLaneCount(rows)).toBe(2);
  });

  it("retains lanes whose parent falls outside truncated history", () => {
    const rows = buildCommitGraph([commit("tip", ["older"])]);

    expect(rows[0].bottomLanes).toEqual(["older"]);
    expect(rows[0].edges).toContainEqual({ from: 0, to: 0, kind: "parent" });
  });
});
