import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { planReconciliation } from "./reconcileTheaters";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictAssignment } from "./assignments";

const unit = (over: Partial<MilitaryUnit>): MilitaryUnit =>
  ({ _id: new ObjectId(), theaterId: "reserve", assignedGeneralId: null, ...over }) as MilitaryUnit;

describe("planReconciliation", () => {
  const assignments: ConflictAssignment[] = [
    { theaterId: "afghan", generalCharacterId: "gen1", inCharge: true },
  ];

  it("moves a unit to its posted general's theater", () => {
    const u = unit({ assignedGeneralId: "gen1", theaterId: "reserve" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "afghan" }]);
  });

  it("returns units to reserve when their general is unposted", () => {
    const u = unit({ assignedGeneralId: "gen2", theaterId: "afghan" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "reserve" }]);
  });

  it("skips units already at their derived theater (no write)", () => {
    const u = unit({ assignedGeneralId: "gen1", theaterId: "afghan" });
    expect(planReconciliation([u], assignments)).toEqual([]);
  });

  it("sends unassigned units to reserve", () => {
    const u = unit({ assignedGeneralId: null, theaterId: "afghan" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "reserve" }]);
  });

  it("floors Garrison → Standard when deploying to a front", () => {
    const u = unit({ assignedGeneralId: "gen1", theaterId: "reserve", posture: "garrison" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "afghan", posture: "standard" }]);
  });

  it("floors a Garrison unit already stranded at a front (posture-only change)", () => {
    const u = unit({ assignedGeneralId: "gen1", theaterId: "afghan", posture: "garrison" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "afghan", posture: "standard" }]);
  });

  it("does not force posture down when returning to reserve", () => {
    const u = unit({ assignedGeneralId: null, theaterId: "afghan", posture: "alert" });
    const plan = planReconciliation([u], assignments);
    expect(plan).toEqual([{ _id: u._id, theaterId: "reserve" }]);
  });

  it("leaves an already-Standard unit at a front untouched", () => {
    const u = unit({ assignedGeneralId: "gen1", theaterId: "afghan", posture: "standard" });
    expect(planReconciliation([u], assignments)).toEqual([]);
  });
});
