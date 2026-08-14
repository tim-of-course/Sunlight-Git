import { describe, expect, it } from "vitest";
import { moveRepository } from "./workspaceOrder";

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
