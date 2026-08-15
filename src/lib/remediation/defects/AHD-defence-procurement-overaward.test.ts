import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { DefenceContract } from "@/lib/db/types";
import { findProcurementClawbacks } from "./AHD-defence-procurement-overaward";

function contract(input: {
  lots: number;
  turn: number;
  corporationId: ObjectId;
  clawedBack?: number;
}): DefenceContract {
  return {
    _id: new ObjectId(),
    countryId: "US",
    corporationId: input.corporationId,
    sectorId: new ObjectId(),
    component: "ground",
    lotsOrdered: input.lots,
    lotsDelivered: input.lots,
    pricePerLot: 372_025_176,
    status: "complete",
    awardedTurn: input.turn,
    administrativeClawbackLots: input.clawedBack,
  };
}

describe("findProcurementClawbacks", () => {
  it("recognizes only one supplier tranche in each contracting window", () => {
    const supplier = new ObjectId();
    const contracts = [
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 20, turn: 96, corporationId: supplier }),
      contract({ lots: 11, turn: 116, corporationId: supplier }),
    ];

    const rows = findProcurementClawbacks(contracts, new Map([["US", 65_081_000_000]]));

    expect(rows.reduce((sum, row) => sum + row.excessLots, 0)).toBe(41);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(15_253_032_216);
  });

  it("is a no-op after the excess lots have already been recovered", () => {
    const supplier = new ObjectId();
    const rows = findProcurementClawbacks(
      [contract({ lots: 10, turn: 96, corporationId: supplier, clawedBack: 4 })],
      new Map([["US", 65_081_000_000]])
    );
    expect(rows).toEqual([]);
  });
});
