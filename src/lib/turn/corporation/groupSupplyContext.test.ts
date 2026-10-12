import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CorporationLookups } from "./types";
import { buildGroupSupplyContext } from "./groupSupplyContext";
import { groupOperator } from "@/lib/corporations/groups/operator";
import type { SettleableSupplyAgreement } from "./settleSupplyAgreements";
function fixture() {
  const root = {
    _id: new ObjectId(),
    ceoId: new ObjectId(),
    ceoType: "character",
    totalShares: 100,
    shareholders: [],
    liquidCapital: 1e12,
    groupManagement: { name: "Group", supplyPolicy: "members" },
  } as unknown as Corporation;
  const child = {
    _id: new ObjectId(),
    ceoId: new ObjectId(),
    ceoType: "npp",
    totalShares: 100,
    shareholders: [{ corporationId: root._id, shares: 75 }],
    subsidiaryFormalizedAtTurn: 1,
    liquidCapital: 1e12,
  } as unknown as Corporation;
  const sector = {
    _id: new ObjectId(),
    corporationId: child._id,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "manufacturing",
    revenue: 1e6,
    profitMargin: 30,
    operatingCapacityUnits: 100,
    producedUnits: 80,
  } as CorporateSector;
  const lookups = {
    corporations: [root, child],
    corpById: new Map([
      [root._id.toString(), root],
      [child._id.toString(), child],
    ]),
    sectorsByCorp: new Map([[child._id.toString(), [sector]]]),
    exchangeRatesByCurrency: new Map(),
    preset: "2019-default",
    eraUnitScale: 1,
    priceRatioByCommodity: new Map(),
  } as unknown as CorporationLookups;
  return { root, child, sector, lookups };
}
describe("loaded group market context", () => {
  it("reserves both state and corporation-wide buyer commitments exactly once", () => {
    const { child, sector, lookups } = fixture();
    const first = buildGroupSupplyContext(lookups, 20, false);
    const [commodity, buyers] = [...first.buyersByCommodity][0];
    const units = buyers[0].requiredUnits;
    const agreements = [
      {
        buyerCorpId: child._id.toString(),
        commodity,
        stateId: sector.stateId,
        volumeCap: units * 0.25,
      },
      { buyerCorpId: child._id.toString(), commodity, volumeCap: units * 0.25 },
    ] as SettleableSupplyAgreement[];
    const next = buildGroupSupplyContext(lookups, 20, false, agreements);
    expect(next.buyersByCommodity.get(commodity)?.[0].contractedUnits).toBeCloseTo(units * 0.5);
    expect(
      next.members.find((m) => m.id === child._id.toString())!.cashAvailableAnchor
    ).toBeLessThan(child.liquidCapital);
  });
  it.each(["suspended", "ceoVacant", "state", "cycle"])(
    "rejects invalid parent authority: %s",
    (kind) => {
      const { root, child, lookups } = fixture();
      if (kind === "suspended") root.suspended = true;
      if (kind === "ceoVacant") root.ceoVacant = true;
      if (kind === "state") root.countryOwnerId = "US";
      if (kind === "cycle") {
        root.subsidiaryFormalizedAtTurn = 1;
        root.shareholders = [{ corporationId: child._id, shares: 75 }];
      }
      expect(buildGroupSupplyContext(lookups, 20, false).members).toEqual([]);
    }
  );
  it("does not treat an NPP caretaker of a player corporation as an autonomous supplier", () => {
    const { root, child } = fixture();
    child.caretakerCeo = { mandate: "active" } as Corporation["caretakerCeo"];
    expect(groupOperator(child, root._id.toString()).operator).toBe("player");
    child.suspended = true;
    expect(groupOperator(child, root._id.toString()).vacant).toBe(true);
  });
});
