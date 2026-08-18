import { describe, expect, it } from "vitest";
import { buildProfileNavItems, visibleProfileNavItems } from "./profileNavItems";

describe("buildProfileNavItems", () => {
  it("always lists Profile then Actions first", () => {
    const ids = visibleProfileNavItems().map((i) => i.id);
    expect(ids).toEqual(["profile", "actions"]);
    expect(visibleProfileNavItems()[0]?.href).toBe("/profile");
    expect(visibleProfileNavItems()[1]?.href).toBe("/actions");
  });

  it("appends corporation after Actions when the viewer is CEO", () => {
    const ids = visibleProfileNavItems({ myCorporationId: 42 }).map((i) => i.id);
    expect(ids).toEqual(["profile", "actions", "corporation"]);
    expect(visibleProfileNavItems({ myCorporationId: 42 }).at(-1)?.href).toBe("/corporation/42");
  });

  it("appends union after corp when the viewer leads or organizes one", () => {
    const items = visibleProfileNavItems({
      myCorporationId: 7,
      myUnionId: "u1",
      unionsEnabled: true,
    });
    expect(items.map((i) => i.id)).toEqual(["profile", "actions", "corporation", "union"]);
    expect(items.at(-1)?.href).toBe("/unions/u1");
  });

  it("shows union without corp when the viewer is a member but not a CEO", () => {
    const items = visibleProfileNavItems({ myUnionId: "u1", unionsEnabled: true });
    expect(items.map((i) => i.id)).toEqual(["profile", "actions", "union"]);
  });

  it("hides union when the labour-full flag is off even if an id is present", () => {
    const items = visibleProfileNavItems({ myUnionId: "u1", unionsEnabled: false });
    expect(items.map((i) => i.id)).not.toContain("union");
  });

  it("hides corporation and union when ids are missing", () => {
    const hidden = buildProfileNavItems({ unionsEnabled: true }).filter((i) => !i.show);
    expect(hidden.map((i) => i.id)).toEqual(["corporation", "union"]);
  });
});
