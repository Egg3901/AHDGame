import { describe, it, expect } from "vitest";
import { activeGroupDirection, groupDirectionLevers } from "./direction";
import { strategyLevers } from "@/lib/turn/npp/corpStrategy";
import type { GroupDirection, GroupObjective } from "../managementTypes";
const ctx = { turn: 11, ceoId: "c", rootId: "r", isNpp: true, caretaker: false, distressed: false };
const direction: GroupDirection = {
  revision: "revision",
  rootId: "r",
  ceoId: "c",
  objective: "expansion",
  regions: [],
  allowInvestment: true,
  setTurn: 10,
  response: "pending",
};
describe("NPP group directions", () => {
  it("preserves survival strategy and cash rails when distressed", () => {
    expect(groupDirectionLevers("retrench", direction, { ...ctx, distressed: true })).toEqual(
      strategyLevers("retrench")
    );
  });
  it("applies objectives using existing strategy rails", () => {
    for (const [objective, expected] of [
      ["profit", "harvest"],
      ["stability", "defend"],
      ["expansion", "expand"],
      ["regional", "expand"],
    ] as const)
      expect(groupDirectionLevers("harvest", { ...direction, objective }, ctx)).toEqual(
        strategyLevers(expected)
      );
    expect(
      groupDirectionLevers("expand", { ...direction, objective: "capacity" }, ctx).allowExpansion
    ).toBe(false);
  });
  it("blocks investment when permission is absent for every objective", () => {
    for (const objective of [
      "balanced",
      "profit",
      "capacity",
      "expansion",
      "regional",
      "stability",
    ] as GroupObjective[]) {
      const result = groupDirectionLevers(
        "expand",
        { ...direction, objective, allowInvestment: false },
        ctx
      );
      expect(result.allowExpansion).toBe(false);
      expect(result.allowGrowthCapex).toBe(false);
    }
  });
  it("cannot control players, caretakers, former operators or former groups", () => {
    for (const change of [
      { isNpp: false },
      { caretaker: true },
      { rootId: "new" },
      { ceoId: "new" },
      { ceoTenureKey: "replacement-tenure" },
      { turn: 10 },
    ]) {
      expect(activeGroupDirection(direction, { ...ctx, ...change })).toBeUndefined();
      expect(groupDirectionLevers("harvest", direction, { ...ctx, ...change })).toEqual(
        strategyLevers("harvest")
      );
    }
  });
});
