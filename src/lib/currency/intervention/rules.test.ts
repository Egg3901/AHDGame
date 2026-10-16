import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { effectiveInterventionPolicy } from "./rules";
import type { InterventionPolicy } from "@/lib/db/types/exchangeRate";
const policy: InterventionPolicy = {
  floor: 0.5,
  ceiling: 0.51,
  setByCharacterId: new ObjectId(),
  setByCharacterName: "Previous band setter",
  setAtTurn: 1,
  lastAdjustedAtTurn: 2,
  lastInfamyChargedAtTurn: 49,
  recentInterventions: [
    {
      turn: 49,
      direction: "buy",
      reservesSpent: 10,
      fundingSource: "spreadFeeReserves",
      resultingRate: 0.6,
    },
  ],
};
describe("effective peg defence", () => {
  it("normalizes stale bounds without attributing the peg to the old band setter", () => {
    const fx = {
      fxRegime: "peg" as const,
      pegTarget: 0.5,
      fxRegimeSetAtTurn: 40,
      interventionPolicy: policy,
    };
    expect(effectiveInterventionPolicy(fx)).toEqual({
      ...policy,
      floor: 0.5,
      ceiling: 0.5,
      setByCharacterId: null,
      setByCharacterName: null,
      setAtTurn: 40,
      lastAdjustedAtTurn: 40,
    });
    expect(fx.interventionPolicy.ceiling).toBe(0.51);
  });
  it("resolves worlds without policy or declaration metadata using unknown attribution", () => {
    expect(effectiveInterventionPolicy({ fxRegime: "peg", pegTarget: 0.5 })).toEqual({
      floor: 0.5,
      ceiling: 0.5,
      setByCharacterId: null,
      setByCharacterName: null,
      setAtTurn: null,
      lastAdjustedAtTurn: null,
      recentInterventions: [],
    });
  });
  it("retains verified point-policy attribution and ongoing breach history", () => {
    const point = { ...policy, ceiling: 0.5 };
    expect(
      effectiveInterventionPolicy({ fxRegime: "peg", pegTarget: 0.5, interventionPolicy: point })
    ).toEqual(point);
  });
  it.each([undefined, "float", "band"] as const)("leaves %s worlds unchanged", (fxRegime) => {
    expect(effectiveInterventionPolicy({ fxRegime, interventionPolicy: policy })).toBe(policy);
    expect(effectiveInterventionPolicy({ fxRegime })).toBeNull();
  });
  it.each([undefined, null, 0, -1, NaN, Infinity])(
    "does not defend invalid peg target %s using a stale band",
    (pegTarget) => {
      expect(
        effectiveInterventionPolicy({ fxRegime: "peg", pegTarget, interventionPolicy: policy })
      ).toBeNull();
    }
  );
});
