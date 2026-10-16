import { describe, expect, it } from "vitest";
import { pickupProductionHistory } from "./rules";

describe("pickup production history", () => {
  it("converts incoming units without manufacturing sales", () => {
    expect(
      pickupProductionHistory({
        receiver: { producedUnits: 40, soldUnits: 20 },
        donor: { producedUnits: 2000, soldUnits: 1000 },
        capacityShare: 0.75,
        unitRatio: 2,
      })
    ).toMatchObject({ producedUnits: 3040, soldUnits: 1520 });
  });

  it("uses the actual whole-plant share rather than a nominal transaction share", () => {
    expect(
      pickupProductionHistory({
        donor: { producedUnits: 80, soldUnits: 60 },
        capacityShare: 1,
        unitRatio: 1,
      })
    ).toMatchObject({ producedUnits: 80, soldUnits: 60 });
  });

  it("weights mixed-output fills by the production that moves", () => {
    expect(
      pickupProductionHistory({
        receiver: { producedUnits: 100, soldUnits: 50, soldByCommodity: { oil: 1, steel: 0 } },
        donor: { producedUnits: 200, soldUnits: 100, soldByCommodity: { oil: 0, steel: 1 } },
        capacityShare: 0.5,
        unitRatio: 1,
      }).soldByCommodity
    ).toEqual({ oil: 0.5, steel: 0.5 });
  });

  it("does not invent history for a plant that has never produced", () => {
    expect(pickupProductionHistory({ donor: {}, capacityShare: 1, unitRatio: 1 })).toEqual({});
  });
});
