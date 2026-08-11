import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));
vi.mock("@/lib/parties/unmannedDefenseShield", () => ({
  resolveUnmannedDefaultCaptureMultiplier: vi.fn().mockResolvedValue(1),
}));

const countryId = "US";
const upperRegionId = "CA";
const partySeq = 1;

function makeAdminUser() {
  return {
    userId: new ObjectId().toString(),
    username: "admin",
    isAdmin: true,
    character: { _id: new ObjectId(), name: "Admin" },
  } as never;
}

function makeParty() {
  return {
    _id: new ObjectId(),
    sequentialId: partySeq,
    countryId,
    name: "Test Party",
    chairId: new ObjectId(),
    viceChairId: new ObjectId(),
    politicalStrength: 0,
  } as never;
}

/** Seed a two-party open state: spender 20% Org, one rival 30% (pool = 50%). */
function seedOpenState(db: MockDb) {
  const spenderRow = {
    _id: `${upperRegionId}_${partySeq}`,
    stateId: upperRegionId,
    partyId: String(partySeq),
    countryId,
    organization: 20,
    politicalStrength: 10,
    hasPresence: true,
  };
  db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(spenderRow);
  db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
    toArray: async () => [
      spenderRow,
      {
        _id: `${upperRegionId}_2`,
        stateId: upperRegionId,
        partyId: "2",
        countryId,
        organization: 30,
        politicalStrength: 8,
      },
    ],
  } as never);
}

describe("computeBuildOrgPreview", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("politicalParties");
    db.collection("partyStrengthPressure");

    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);
    // No rival party docs needed for the shield/blend (shield mocked to 1).
    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);
  });

  it("effective cost equals base (1) when there is no pressure row", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pressureValue).toBe(0);
      expect(result.effectiveCost).toBe(1);
      expect(result.projectedGain).toBeGreaterThan(0);
    }
  });

  it("effective cost climbs with the pressure ladder (pressure 2 → cost 3)", async () => {
    // Regression: the estimate must reflect the CURRENT ladder value so it can't
    // under-report the charge after repeated building.
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue({
      _id: `${countryId}_${partySeq}_${upperRegionId}`,
      countryId,
      partyId: String(partySeq),
      stateId: upperRegionId,
      value: 2,
      lastUpdatedTurn: 5,
    });

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pressureValue).toBe(2);
      expect(result.effectiveCost).toBe(3);
    }
  });

  it("saturates the cost at the ladder max (8)", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue({
      _id: `${countryId}_${partySeq}_${upperRegionId}`,
      value: 50,
    });

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.effectiveCost).toBe(8);
  });

  it("returns ok=false reason=no-presence without live presence", async () => {
    seedOpenState(db);
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-presence");
  });

  it("returns ok=false reason=auth for a non-officer, non-admin viewer", async () => {
    seedOpenState(db);
    const nonOfficer = {
      userId: new ObjectId().toString(),
      username: "member",
      isAdmin: false,
      character: { _id: new ObjectId(), name: "Member" },
    } as never;

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: nonOfficer,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("auth");
  });

  it("returns ok=false reason=no-headroom when the spender holds 100% and no rival has Org", async () => {
    const soleRow = {
      _id: `${upperRegionId}_${partySeq}`,
      stateId: upperRegionId,
      partyId: String(partySeq),
      countryId,
      organization: 100,
      politicalStrength: 10,
      hasPresence: true,
    };
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(soleRow);
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [soleRow],
    } as never);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const result = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no-headroom");
  });

  it("does not mutate any collection (read-only invariant)", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });

    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["statePartyOrg"]!.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks["partyStrengthPressure"]!.updateOne).not.toHaveBeenCalled();
  });
});
