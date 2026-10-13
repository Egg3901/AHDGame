import { describe, expect, it } from "vitest";
import { resolveMembershipRows } from "./membership";
describe("cycle membership", () => {
  it("does not choose a smaller descendant as the root of a cycle", () => {
    const groups = resolveMembershipRows([
      { id: "a", parentId: "z", formalized: true },
      { id: "y", parentId: "z", formalized: true },
      { id: "z", parentId: "y", formalized: true },
    ]);
    expect([...groups.rootByCorpId.values()]).toEqual(["y", "y", "y"]);
    expect(groups.membersByRootId.get("y")).toEqual(["a", "y", "z"]);
  });
});
