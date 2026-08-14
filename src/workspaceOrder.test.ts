import { describe, expect, it } from "vitest";
import {
  moveRepository,
  moveRepositoryToIndex,
  reorderIndexFromPointer
} from "./workspaceOrder";

describe("moveRepository", () => {
  it("moves a repository before the drop target", () => {
    expect(moveRepository(["one", "two", "three"], "three", "two")).toEqual([
      "one",
      "three",
      "two"
    ]);
  });

  it("leaves unknown and identical identifiers unchanged", () => {
    const ids = ["one", "two"];
    expect(moveRepository(ids, "one", "one")).toBe(ids);
    expect(moveRepository(ids, "missing", "two")).toBe(ids);
  });
});

describe("moveRepositoryToIndex", () => {
  it("moves a repository to a new index", () => {
    expect(moveRepositoryToIndex(["one", "two", "three"], "one", 2)).toEqual([
      "two",
      "three",
      "one"
    ]);
    expect(moveRepositoryToIndex(["one", "two", "three"], "three", 0)).toEqual([
      "three",
      "one",
      "two"
    ]);
  });

  it("leaves unknown and identical indexes unchanged", () => {
    const ids = ["one", "two"];
    expect(moveRepositoryToIndex(ids, "one", 0)).toBe(ids);
    expect(moveRepositoryToIndex(ids, "missing", 1)).toBe(ids);
  });
});

describe("reorderIndexFromPointer", () => {
  const items = [
    { top: 0, height: 40 },
    { top: 44, height: 40 },
    { top: 88, height: 40 }
  ];

  it("inserts before the first item whose midpoint is below the pointer", () => {
    expect(reorderIndexFromPointer(10, items)).toBe(0);
    expect(reorderIndexFromPointer(50, items)).toBe(1);
    expect(reorderIndexFromPointer(120, items)).toBe(2);
  });

  it("clamps empty lists to zero", () => {
    expect(reorderIndexFromPointer(10, [])).toBe(0);
  });
});
