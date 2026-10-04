import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { ConstructionBuildClaim } from "@/lib/banking/rules/constructionBuild";
import {
  hasProtectedConstructionProperty,
  hasProtectedConstructionPropertyIn,
  reserveSectorsForRestore,
  reserveSectorsForTransition,
  unprotectedConstructionPropertyFilter,
} from "./securedConstructionProperty";

function claim(overrides: Partial<ConstructionBuildClaim> = {}): ConstructionBuildClaim {
  return {
    claimId: "claim-1",
    loanId: "loan-1",
    bankId: "bank-1",
    charteredTurn: 1,
    borrowerId: "corp-1",
    currency: "USD",
    constructionCostLocal: 100,
    collateralCostLocal: 100,
    borrowerContributionLocal: 50,
    principal: 50,
    proceedsLocal: 50,
    termTurns: 12,
    ratePercent: 5,
    order: { unitsOrdered: 1, costPaidAnchor: 100, startTurn: 1, onlineTurn: 2 },
    status: "building",
    escrowLocal: 0,
    ...overrides,
  };
}

describe("secured construction property guard", () => {
  it("protects an active pledge even after its construction escrow is empty", () => {
    expect(hasProtectedConstructionProperty({ constructionFinancing: claim() })).toBe(true);
  });

  it("protects positive escrow even when a stale status says the claim is terminal", () => {
    expect(
      hasProtectedConstructionProperty({
        constructionFinancing: claim({ status: "released", escrowLocal: 0.01 }),
      })
    ).toBe(true);
  });

  it("fails closed for malformed terminal claims and incomplete cancellation cleanup", () => {
    expect(
      hasProtectedConstructionProperty({
        constructionFinancing: claim({ status: "released", escrowLocal: Number.NaN }),
      })
    ).toBe(true);
    expect(
      hasProtectedConstructionProperty({
        constructionFinancing: claim({
          status: "cancelled",
          cancellation: { cleanupCompleted: false } as ConstructionBuildClaim["cancellation"],
        }),
      })
    ).toBe(true);
  });

  it("allows a fully released claim and ignores legacy sectors without claims", () => {
    expect(
      hasProtectedConstructionProperty({
        constructionFinancing: claim({ status: "released", escrowLocal: 0 }),
      })
    ).toBe(false);
    expect(hasProtectedConstructionProperty({ constructionFinancing: undefined })).toBe(false);
  });

  it("checks an already loaded sector cohort without querying storage", () => {
    expect(
      hasProtectedConstructionPropertyIn([
        { constructionFinancing: undefined },
        { constructionFinancing: claim({ status: "funding" }) },
      ])
    ).toBe(true);
    expect(hasProtectedConstructionPropertyIn([{ constructionFinancing: undefined }])).toBe(false);
  });

  it("builds an atomic Mongo predicate that excludes all active or malformed claim states", () => {
    expect(unprotectedConstructionPropertyFilter()).toEqual({
      $and: [
        { constructionPropertyTransition: { $exists: false } },
        {
          $or: [
            { constructionFinancing: { $exists: false } },
            {
              $and: [
                { "constructionFinancing.status": { $in: ["released", "cancelled"] } },
                { "constructionFinancing.escrowLocal": 0 },
                {
                  $or: [
                    { "constructionFinancing.cancellation": { $exists: false } },
                    { "constructionFinancing.cancellation.cleanupCompleted": true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("reserves unpledged rows before restoration and refuses an active pledge atomically", async () => {
    const db = createMockDb();
    const sector = {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      constructionFinancing: undefined,
    };

    expect(await reserveSectorsForRestore(db as unknown as Db, [sector])).toBe(true);
    const [filter, update] = db.collectionMocks.corporateSectors.updateOne.mock.calls[0]!;
    expect(filter).toMatchObject({
      _id: sector._id,
      corporationId: sector.corporationId,
      $and: expect.any(Array),
    });
    expect(update).toEqual({
      $set: {
        constructionPropertyTransition: {
          key: `restore:${sector._id.toHexString()}`,
          kind: "restore",
        },
      },
    });

    const pledged = { ...sector, constructionFinancing: claim({ status: "building" }) };
    const otherDb = createMockDb();
    expect(await reserveSectorsForRestore(otherDb as unknown as Db, [pledged])).toBe(false);
    expect(otherDb.collectionMocks.corporateSectors).toBeUndefined();
  });

  it("refuses a same-currency relocation when a concurrent claim wins the property reservation", async () => {
    const db = createMockDb();
    db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 0 });
    const sector = {
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      constructionFinancing: undefined,
    };

    expect(
      await reserveSectorsForTransition(
        db as unknown as Db,
        [sector],
        "headquarters_relocation",
        "hq:test"
      )
    ).toBeNull();
    const [filter] = db.collectionMocks.corporateSectors.updateOne.mock.calls[0]!;
    expect(filter).toMatchObject({
      _id: sector._id,
      corporationId: sector.corporationId,
      $and: expect.any(Array),
    });
  });
});
