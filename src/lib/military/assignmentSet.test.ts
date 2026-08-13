import { describe, it, expect } from "vitest";
import type { ConflictAssignment } from "./assignments";
import { assignmentSet } from "./assignmentSet";

const a = (over: Partial<ConflictAssignment> = {}): ConflictAssignment => ({
  theaterId: "afghan",
  generalCharacterId: "g1",
  inCharge: false,
  ...over,
});

describe("assignmentSet", () => {
  const posted = [a({ theaterId: "afghan", generalCharacterId: "g1", inCharge: true })];

  it("writes theater from the general and omits posture when it does not change", () => {
    expect(assignmentSet("g1", posted, "standard")).toEqual({
      assignedGeneralId: "g1",
      theaterId: "afghan",
    });
  });

  it("floors Garrison to Standard when the general is at a front", () => {
    expect(assignmentSet("g1", posted, "garrison")).toEqual({
      assignedGeneralId: "g1",
      theaterId: "afghan",
      posture: "standard",
    });
  });

  it("clears to General Staff and reserve without touching Garrison", () => {
    expect(assignmentSet(null, posted, "garrison")).toEqual({
      assignedGeneralId: null,
      theaterId: "reserve",
    });
  });
});
