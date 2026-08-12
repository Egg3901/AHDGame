import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { employerPensionCostForTurn } from "./employerPensionCosts";
import { PENSION_DEFICIT_RATIO, PENSION_TOPUP_FRACTION } from "./rules";

const CORP_ID = new ObjectId();
const UNION_ID = new ObjectId();
const SECTOR_A = new ObjectId();
const SECTOR_B = new ObjectId();

function agreement(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    unionId: UNION_ID,
    employerCorporationId: CORP_ID,
    sectorIds: [SECTOR_A],
    status: "active",
    startsAtTurn: 1,
    expiresAtTurn: 100,
    pensionContributionRate: 0.05,
    ...overrides,
  };
}

function scheme(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    unionId: UNION_ID,
    countryId: "US",
    unionName: "Test Workers",
    assetsAnchor: 0,
    liabilitiesAnchor: 0,
    totalContributionsAnchor: 0,
    totalTopUpsAnchor: 0,
    createdAtTurn: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function withAgreements(db: MockDb, agreements: unknown[], schemes: unknown[]) {
  db.collection("collectiveAgreements").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(agreements),
  });
  db.collection("pensionSchemes").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(schemes),
  });
}

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

describe("employerPensionCostForTurn", () => {
  it("charges the bargained rate on the covered sectors only", async () => {
    withAgreements(db, [agreement()], [scheme()]);
    const wageBill = new Map([
      [SECTOR_A.toString(), 1000],
      [SECTOR_B.toString(), 4000],
    ]);

    const cost = await employerPensionCostForTurn(db as unknown as Db, CORP_ID, 10, wageBill);
    expect(cost.contributionAnchorPerTurn).toBe(50);
    expect(cost.topUpAnchorPerTurn).toBe(0);
    expect(cost.agreements).toBe(1);
  });

  it("adds the deficit top-up on the position after this turn's contribution", async () => {
    withAgreements(
      db,
      [agreement()],
      [scheme({ assetsAnchor: 10_000, liabilitiesAnchor: 100_000 })]
    );
    const wageBill = new Map([[SECTOR_A.toString(), 1000]]);

    const cost = await employerPensionCostForTurn(db as unknown as Db, CORP_ID, 10, wageBill);
    const expectedShortfall = 100_000 * PENSION_DEFICIT_RATIO - (10_000 + 50);
    expect(cost.contributionAnchorPerTurn).toBe(50);
    expect(cost.topUpAnchorPerTurn).toBeCloseTo(expectedShortfall * PENSION_TOPUP_FRACTION, 6);
    expect(cost.schemesInDeficit).toBe(1);
  });

  it("counts a funded scheme as owing no top-up", async () => {
    withAgreements(
      db,
      [agreement()],
      [scheme({ assetsAnchor: 100_000, liabilitiesAnchor: 100_000 })]
    );

    const cost = await employerPensionCostForTurn(
      db as unknown as Db,
      CORP_ID,
      10,
      new Map([[SECTOR_A.toString(), 1000]])
    );
    expect(cost.topUpAnchorPerTurn).toBe(0);
    expect(cost.schemesInDeficit).toBe(0);
  });

  it("charges nothing for a covered sector with no measured wage bill", async () => {
    withAgreements(db, [agreement()], [scheme({ liabilitiesAnchor: 100_000 })]);

    const cost = await employerPensionCostForTurn(db as unknown as Db, CORP_ID, 10, new Map());
    expect(cost.contributionAnchorPerTurn).toBe(0);
    expect(cost.topUpAnchorPerTurn).toBe(0);
    expect(cost.agreements).toBe(1);
  });

  it("charges the contribution even before the scheme document exists", async () => {
    withAgreements(db, [agreement()], []);

    const cost = await employerPensionCostForTurn(
      db as unknown as Db,
      CORP_ID,
      10,
      new Map([[SECTOR_A.toString(), 1000]])
    );
    expect(cost.contributionAnchorPerTurn).toBe(50);
    expect(cost.topUpAnchorPerTurn).toBe(0);
  });

  it("reads nothing when the employer has no agreement carrying a rate", async () => {
    withAgreements(db, [], []);

    const cost = await employerPensionCostForTurn(db as unknown as Db, CORP_ID, 10, new Map());
    expect(cost).toEqual({
      contributionAnchorPerTurn: 0,
      topUpAnchorPerTurn: 0,
      agreements: 0,
      schemesInDeficit: 0,
    });
    expect(db.collection("pensionSchemes").find).not.toHaveBeenCalled();
  });

  it("sums every agreement the employer is party to", async () => {
    withAgreements(
      db,
      [
        agreement(),
        agreement({ sectorIds: [SECTOR_B], pensionContributionRate: 0.1 }),
      ],
      [scheme()]
    );
    const wageBill = new Map([
      [SECTOR_A.toString(), 1000],
      [SECTOR_B.toString(), 2000],
    ]);

    const cost = await employerPensionCostForTurn(db as unknown as Db, CORP_ID, 10, wageBill);
    expect(cost.contributionAnchorPerTurn).toBe(50 + 200);
    expect(cost.agreements).toBe(2);
  });
});
