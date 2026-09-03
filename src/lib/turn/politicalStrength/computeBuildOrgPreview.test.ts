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

/**
 * Seed a two-party open state: spender 20% Org, one rival 30% (pool = 50%).
 *
 * `treasury` defaults high enough to fully fund any click, so cases that are
 * not about money read as fully funded; the funding cases pass it explicitly.
 */
function seedOpenState(db: MockDb, treasury = 10_000_000) {
  const spenderRow = {
    _id: `${upperRegionId}_${partySeq}`,
    stateId: upperRegionId,
    partyId: String(partySeq),
    countryId,
    organization: 20,
    politicalStrength: 10,
    hasPresence: true,
    treasury,
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

  // ── Treasury cost (2026-09-02) ──────────────────────────────────────────
  // The estimate must price the cash side too, or it over-promises: a partly
  // funded click yields proportionally less Org than the PS math alone implies.

  async function preview(dbRef: MockDb) {
    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    return computeBuildOrgPreview(dbRef as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: makeParty(),
      authUser: makeAdminUser(),
    });
  }

  it("quotes the cash price of the next click off the country's state rate", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const result = await preview(db);

    expect(result.ok).toBe(true);
    // US state rate 37,500 × ORG_BUILD_TREASURY_FRACTION × 1 PS.
    if (result.ok) expect(result.cashPrice).toBe(Math.round(37_500 * 0.075));
  });

  it("cash price rises with the pressure ladder alongside the PS cost", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue({
      _id: `${countryId}_${partySeq}_${upperRegionId}`,
      value: 2,
    });

    const result = await preview(db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effectiveCost).toBe(3);
      expect(result.cashPrice).toBe(Math.round(37_500 * 0.075 * 3));
    }
  });

  it("reports a fully funded click when the treasury covers the price", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const result = await preview(db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fundedFraction).toBe(1);
      expect(result.treasuryAvailable).toBe(10_000_000);
    }
  });

  it("shrinks the projected gain in proportion to a short treasury", async () => {
    seedOpenState(db);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);
    const funded = await preview(db);
    expect(funded.ok).toBe(true);
    if (!funded.ok) return;

    // Half the price on hand → half the Org.
    vi.clearAllMocks();
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);
    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: async () => [],
    } as never);
    seedOpenState(db, funded.cashPrice / 2);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const short = await preview(db);

    expect(short.ok).toBe(true);
    if (short.ok) {
      expect(short.fundedFraction).toBeCloseTo(0.5, 6);
      expect(short.projectedGain).toBeCloseTo(funded.projectedGain * 0.5, 6);
    }
  });

  it("returns ok=false reason=insufficient-funds below the minimum funded fraction", async () => {
    // 10% of the price is under the 25% floor.
    seedOpenState(db, 37_500 * 0.075 * 0.1);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const result = await preview(db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient-funds");
  });

  // The bulk HQ tool always spends the national pool, so it has to be able to
  // ask for a national quote. Without this the estimate prices at the state rate
  // (half) and checks the state treasury, while the run charges the national
  // rate against the national treasury.
  it("prices against the national tier when the caller asks for that pool", async () => {
    // A dual-role officer: national chair of the party AND state chair here.
    // Default precedence picks "state"; the bulk tool must be able to ask for
    // the national quote it is actually going to spend.
    const officerId = new ObjectId();
    const spenderRow = {
      _id: `${upperRegionId}_${partySeq}`,
      stateId: upperRegionId,
      partyId: String(partySeq),
      countryId,
      organization: 20,
      politicalStrength: 10,
      hasPresence: true,
      treasury: 10_000_000,
      chairId: officerId,
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
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const party = {
      _id: new ObjectId(),
      sequentialId: partySeq,
      countryId,
      name: "Test Party",
      chairId: officerId,
      viceChairId: new ObjectId(),
      politicalStrength: 0,
      treasury: 9_000_000,
    } as never;
    const officer = {
      userId: new ObjectId().toString(),
      username: "dual",
      isAdmin: false,
      character: { _id: officerId, name: "Dual Officer" },
    } as never;

    const { computeBuildOrgPreview } = await import("./computeBuildOrgPreview");
    const stateQuote = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: party,
      authUser: officer,
    });
    const nationalQuote = await computeBuildOrgPreview(db as unknown as Db, {
      countryId,
      upperRegionId,
      spenderParty: party,
      authUser: officer,
      preferredScope: "national-targeted",
    });

    expect(stateQuote.ok && stateQuote.scope).toBe("state");
    expect(nationalQuote.ok).toBe(true);
    if (nationalQuote.ok) {
      expect(nationalQuote.scope).toBe("national-targeted");
      // US national rate 75,000, twice the state rate, against the national pot.
      expect(nationalQuote.cashPrice).toBe(Math.round(75_000 * 0.075));
      expect(nationalQuote.treasuryAvailable).toBe(9_000_000);
    }
  });

  it("refuses an empty treasury rather than quoting a free click", async () => {
    seedOpenState(db, 0);
    db.collectionMocks["partyStrengthPressure"]!.findOne.mockResolvedValue(null);

    const result = await preview(db);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("insufficient-funds");
  });
});
