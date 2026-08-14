import type { Commit } from "./types";

export type GraphEdge = {
  from: number;
  to: number;
  kind: "lane" | "parent";
};

export type CommitGraphRow = {
  commit: Commit;
  lane: number;
  incoming: boolean;
  topLanes: string[];
  bottomLanes: string[];
  edges: GraphEdge[];
};

export function buildCommitGraph(commits: Commit[]): CommitGraphRow[] {
  let activeLanes: string[] = [];

  return commits.map((commit) => {
    let lane = activeLanes.indexOf(commit.oid);
    const incoming = lane >= 0;

    if (lane === -1) {
      lane = activeLanes.length;
      activeLanes = [...activeLanes, commit.oid];
    }

    const topLanes = [...activeLanes];
    const bottomLanes = topLanes.filter((oid) => oid !== commit.oid);

    commit.parent_oids.forEach((parentOid, parentIndex) => {
      if (bottomLanes.includes(parentOid)) return;
      const insertionLane = Math.min(lane + parentIndex, bottomLanes.length);
      bottomLanes.splice(insertionLane, 0, parentOid);
    });

    const edges: GraphEdge[] = [];

    topLanes.forEach((oid, topLane) => {
      if (oid === commit.oid) return;
      const bottomLane = bottomLanes.indexOf(oid);
      if (bottomLane >= 0) edges.push({ from: topLane, to: bottomLane, kind: "lane" });
    });

    commit.parent_oids.forEach((parentOid) => {
      const parentLane = bottomLanes.indexOf(parentOid);
      if (parentLane >= 0) edges.push({ from: lane, to: parentLane, kind: "parent" });
    });

    activeLanes = bottomLanes;

    return {
      commit,
      lane,
      incoming,
      topLanes,
      bottomLanes: [...bottomLanes],
      edges
    };
  });
}

export function graphLaneCount(rows: CommitGraphRow[]) {
  return Math.max(
    1,
    ...rows.map((row) => Math.max(row.topLanes.length, row.bottomLanes.length))
  );
}
