import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processPartyTierTurn } from "./partyTierTurn";
import { MAJOR_DEMOTION_GRACE_TURNS } from "@/lib/parties/partyTier";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const now = new Date("2026-06-18T00:00:00Z");

function setOrgRows(db: MockDb, rows: Array<Record<string, unknown>>) {
  db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
    toArray: async () => rows,
  } as never);
}
function setParties(db: MockDb, parties: Array<Record<string, unknown>>) {
  db.collectionMocks["politicalParties"]!.find.mockReturnValue({
    toArray: async () => parties,
  } as never);
}

// UK: 12 regions → graduation 4, demotion 8.
function ukOrgRows(partyId: string, regionsAtPct: Array<[string, number]>) {
  return regionsAtPct.map(([stateId, organization]) => ({
    countryId: "UK",
    stateId,
    partyId,
    organization,
  }));
}

describe("processPartyTierTurn", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("statePartyOrg");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    setParties(db, []);
    setOrgRows(db, []);
  });

  it("promotes a Minor party that reaches 20% Org in ⌈regions/3⌉ regions", async () => {
    const id = new ObjectId();
    setParties(db, [
      {
        _id: id,
        sequentialId: 5,
        countryId: "UK",
        tier: "minor",
        isDefault: false,
        politicalStrength: 90,
      },
    ]);
    setOrgRows(
      db,
      ukOrgRows("5", [
        ["ENG", 25],
        ["SCT", 25],
        ["WLS", 25],
        ["NIR", 25],
      ])
    );

    const r = await processPartyTierTurn(100, now);
    expect(r.promoted).toBe(1);

    const call = db.collectionMocks["politicalParties"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set?: Record<string, unknown> } };
    }>;
    expect(call[0].updateOne.update.$set?.tier).toBe("major");
  });

  it("seeds an UNSET regional default to Minor (proposal), not the default→major fallback", async () => {
    // Regression for the deploy-before-heal incident: a default party whose tier
    // is still unset must seed from resolveSeedPartyTier (SNP → Minor), NOT the
    // read-time default→major fallback. SNP holds 20% Org in only 1 of 12 UK
    // regions, well below the graduation threshold.
    const id = new ObjectId();
    setParties(db, [
      {
        _id: id,
        sequentialId: 9,
        countryId: "UK",
        abbreviation: "SNP",
        isDefault: true,
        // tier intentionally UNSET
        politicalStrength: 128,
      },
    ]);
    setOrgRows(db, ukOrgRows("9", [["SCT", 25]]));

    const r = await processPartyTierTurn(100, now);
    const call = db.collectionMocks["politicalParties"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set?: Record<string, unknown> } };
    }>;
    expect(call[0].updateOne.update.$set?.tier).toBe("minor");
    expect(r.demoted).toBe(0);
  });

  it("starts a demotion warning for an at-risk Major party", async () => {
    const id = new ObjectId();
    setParties(db, [
      {
        _id: id,
        sequentialId: 1,
        countryId: "UK",
        tier: "major",
        isDefault: true,
        politicalStrength: 100,
      },
    ]);
    // Org in only 3 of 12 regions → 9 below 10% ≥ demotion threshold 8.
    setOrgRows(
      db,
      ukOrgRows("1", [
        ["ENG", 15],
        ["SCT", 15],
        ["WLS", 15],
      ])
    );

    const r = await processPartyTierTurn(200, now);
    expect(r.warningsStarted).toBe(1);
    const call = db.collectionMocks["politicalParties"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set?: Record<string, unknown> } };
    }>;
    expect(call[0].updateOne.update.$set?.majorDemotionWarning).toEqual({ startedTurn: 200 });
  });

  it("demotes a Major party when the warning grace elapses, clamping PS to the new cap", async () => {
    const id = new ObjectId();
    setParties(db, [
      {
        _id: id,
        sequentialId: 1,
        countryId: "UK",
        tier: "major",
        isDefault: true,
        politicalStrength: 128, // at the UK Major cap
        psCapEarnedRegions: ["ENG"], // 1 earned → Minor cap 110
        majorDemotionWarning: { startedTurn: 50 },
      },
    ]);
    // Still failing: org only in ENG (15%), so 11 regions below 10% → at-risk.
    setOrgRows(db, ukOrgRows("1", [["ENG", 15]]));

    const r = await processPartyTierTurn(50 + MAJOR_DEMOTION_GRACE_TURNS, now);
    expect(r.demoted).toBe(1);
    expect(r.psClampedDown).toBe(1);

    const call = db.collectionMocks["politicalParties"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> } };
    }>;
    expect(call[0].updateOne.update.$set?.tier).toBe("minor");
    // 1 earned region → cap 100 + 10 = 110; PS 128 clamps to 110.
    expect(call[0].updateOne.update.$set?.politicalStrength).toBe(110);
    expect(call[0].updateOne.update.$unset?.majorDemotionWarning).toBeDefined();
  });

  it("makes no write when nothing changes", async () => {
    const id = new ObjectId();
    setParties(db, [
      {
        _id: id,
        sequentialId: 1,
        countryId: "UK",
        tier: "major",
        isDefault: true,
        politicalStrength: 50,
        // Already earned exactly the 4 regions it holds → earned set is unchanged.
        psCapEarnedRegions: ["ENG", "NIR", "SCT", "WLS"],
      },
    ]);
    // Healthy across the board → meets graduation, no warning, no clamp.
    setOrgRows(
      db,
      ukOrgRows("1", [
        ["ENG", 30],
        ["SCT", 30],
        ["WLS", 30],
        ["NIR", 30],
      ])
    );

    const r = await processPartyTierTurn(300, now);
    expect(r.partiesUpdated).toBe(0);
    expect(db.collectionMocks["politicalParties"]!.bulkWrite).not.toHaveBeenCalled();
  });
});
