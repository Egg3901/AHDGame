import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BUILD_ORG_BASE_PS_COST } from "@/lib/turn/politicalStrength/strengthConstants";

vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/parties/commands/spendPoliticalStrength", () => ({
  spendPoliticalStrength: vi.fn(),
}));
vi.mock("@/lib/turn/partyOrg/presence", () => ({ checkPartyPresence: vi.fn() }));
vi.mock("@/lib/parties/commands/chargeOrgBuildFunds", () => ({
  chargeOrgBuildFunds: vi.fn(),
}));

const countryId = "US";
const stateId = "CA";
const partySeq = 1;
const actorNppId = new ObjectId();

describe("nppBuildPartyOrg", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("statePartyOrg");
    db.collection("orgRegLedger");

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: partySeq,
      countryId,
      name: "Test Party",
      chairId: null,
      viceChairId: null,
    } as never);

    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(true);

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: `${stateId}_${partySeq}`,
      stateId,
      partyId: String(partySeq),
      countryId,
      organization: 20,
      politicalStrength: 10,
      treasury: 10_000_000,
      hasPresence: true,
    });

    // Default: the state treasury covers the click's cash price in full.
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    vi.mocked(chargeOrgBuildFunds).mockImplementation(async (input) => ({
      charged: input.amount,
    }));

    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: `${stateId}_${partySeq}`,
          stateId,
          partyId: String(partySeq),
          countryId,
          organization: 20,
          politicalStrength: 10,
        },
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId,
          organization: 30,
          politicalStrength: 8,
        },
      ],
    } as never);
    db.collectionMocks["statePartyOrg"]!.findOneAndUpdate.mockImplementation(async () => {
      const rows = await db.collectionMocks["statePartyOrg"]!.find().toArray();
      const legacyTotal = rows.reduce(
        (sum: number, row: { organization?: number; organizationUnits?: number }) =>
          row.organizationUnits === undefined ? sum + (row.organization ?? 0) : sum,
        0
      );
      const legacyScale = Math.min(10, 100 / Math.max(1, 100 - Math.min(99, legacyTotal)));
      const rowId = `${stateId}_${partySeq}`;
      const current =
        rows.find((row: { _id?: string }) => row._id === rowId) ??
        ({
          _id: rowId,
          stateId,
          partyId: String(partySeq),
          countryId,
          organization: 0,
          politicalStrength: 10,
          treasury: 10_000_000,
          hasPresence: true,
        } as const);
      return {
        ...current,
        organizationUnits:
          (current.organizationUnits ?? (current.organization ?? 0) * legacyScale) + 1,
        lastOrganizationBuildTurn: 100,
      };
    });

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    vi.mocked(spendPoliticalStrength).mockResolvedValue({
      ok: true,
      effectiveCost: BUILD_ORG_BASE_PS_COST,
      newPoliticalStrength: 10 - BUILD_ORG_BASE_PS_COST,
      newPressure: 1,
    });
  });

  it("builds org, spends state-scoped PS, and logs the spender's gain", async () => {
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(
      db as unknown as Db,
      actorNppId,
      countryId,
      stateId,
      partySeq,
      100
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.orgGain).toBeGreaterThan(0);
    expect(result.newOrg).toBeGreaterThan(20);
    expect(db.collectionMocks["orgRegLedger"]!.insertMany).toHaveBeenCalledTimes(1);

    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "state", countryId, stateId, partyId: String(partySeq) }),
      db
    );

    expect(db.collectionMocks["statePartyOrg"]!.bulkWrite).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { _id: `${stateId}_${partySeq}`, organizationUnits: 41 },
          }),
        }),
      ])
    );

    const insertCalls = db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls.flatMap(
      (c: unknown[]) => c[0] as unknown[]
    );
    expect(db.collectionMocks["orgRegLedger"]!.insertOne).not.toHaveBeenCalled();
    const gainLog = insertCalls.find((d: unknown) => (d as { source: string }).source === "action");
    expect(gainLog).toMatchObject({
      countryId,
      stateId,
      partyId: String(partySeq),
      metric: "org",
      source: "action",
      actorId: actorNppId,
      note: "action:npp-build-org",
    });
  });

  it("logs passive dilution against rivals once the bucket exceeds its baseline", async () => {
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: `${stateId}_${partySeq}`,
          stateId,
          partyId: String(partySeq),
          countryId,
          organization: 60,
          organizationUnits: 60,
        },
        {
          _id: `${stateId}_2`,
          stateId,
          partyId: "2",
          countryId,
          organization: 40,
          organizationUnits: 40,
        },
      ],
    } as never);
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    await nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, stateId, partySeq, 100);

    const insertCalls = db.collectionMocks["orgRegLedger"]!.insertMany.mock.calls.flatMap(
      (c: unknown[]) => c[0] as unknown[]
    );
    const dilutionLog = insertCalls.find(
      (d: unknown) => (d as { source: string }).source === "passive"
    );
    expect(dilutionLog).toMatchObject({
      countryId,
      stateId,
      partyId: "2",
      source: "passive",
      actorId: null,
    });
  });

  it("returns ok:false when the party has no presence in the state", async () => {
    const { checkPartyPresence } = await import("@/lib/turn/partyOrg/presence");
    vi.mocked(checkPartyPresence).mockResolvedValue(false);

    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(
      db as unknown as Db,
      actorNppId,
      countryId,
      stateId,
      partySeq,
      100
    );

    expect(result).toEqual({ ok: false, reason: "No presence in this state." });
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).not.toHaveBeenCalled();
  });

  it("returns ok:false when the party is not found", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(
      db as unknown as Db,
      actorNppId,
      countryId,
      stateId,
      partySeq,
      100
    );

    expect(result).toEqual({ ok: false, reason: "Party not found." });
  });

  it("returns ok:false and does not mutate org when the PS spend fails", async () => {
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    vi.mocked(spendPoliticalStrength).mockResolvedValue({
      ok: false,
      reason: "insufficient-ps",
      effectiveCost: BUILD_ORG_BASE_PS_COST,
      currentPoliticalStrength: 0,
    });

    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(
      db as unknown as Db,
      actorNppId,
      countryId,
      stateId,
      partySeq,
      100
    );

    expect(result).toEqual({ ok: false, reason: "Insufficient PS." });
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("continues building when the party currently holds the full share", async () => {
    db.collectionMocks["statePartyOrg"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: `${stateId}_${partySeq}`,
          stateId,
          partyId: String(partySeq),
          countryId,
          organization: 100,
          organizationUnits: 100,
          politicalStrength: 10,
        },
      ],
    } as never);

    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    const result = await nppBuildPartyOrg(
      db as unknown as Db,
      actorNppId,
      countryId,
      stateId,
      partySeq,
      100
    );

    expect(result.ok).toBe(true);
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    expect(spendPoliticalStrength).toHaveBeenCalled();
  });

  // ── Treasury cost (2026-09-02) ──────────────────────────────────────────
  // An NPP-run party pays the same cash price a player would, or it would be
  // able to organise for free the moment this sweep wakes up.

  async function build() {
    const { nppBuildPartyOrg } = await import("./nppBuildOrg");
    return nppBuildPartyOrg(db as unknown as Db, actorNppId, countryId, stateId, partySeq, 100);
  }

  it("charges the state treasury for the click", async () => {
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");

    const result = await build();

    expect(result.ok).toBe(true);
    expect(chargeOrgBuildFunds).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "state",
        stateRowId: `${stateId}_${partySeq}`,
        countryId,
        partyId: String(partySeq),
        // US state rate 37,500 × 0.075 × 1 PS.
        amount: Math.round(37_500 * 0.075 * BUILD_ORG_BASE_PS_COST),
      }),
      expect.anything(),
      // No sweep cache here, so the command loads its own accounting context.
      undefined
    );
  });

  it("does not build, or spend PS, when the state treasury is below the funded floor", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: `${stateId}_${partySeq}`,
      stateId,
      partyId: String(partySeq),
      countryId,
      organization: 20,
      politicalStrength: 10,
      treasury: 37_500 * 0.075 * 0.1,
      hasPresence: true,
    });

    const result = await build();

    expect(result.ok).toBe(false);
    const { spendPoliticalStrength } =
      await import("@/lib/parties/commands/spendPoliticalStrength");
    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    expect(spendPoliticalStrength).not.toHaveBeenCalled();
    expect(chargeOrgBuildFunds).not.toHaveBeenCalled();
  });

  it("keeps the fixed org contribution when the treasury only partly funds the click", async () => {
    const full = await build();
    expect(full.ok).toBe(true);
    if (!full.ok) return;

    const { chargeOrgBuildFunds } = await import("@/lib/parties/commands/chargeOrgBuildFunds");
    vi.mocked(chargeOrgBuildFunds).mockImplementation(async (input) => ({
      charged: input.amount / 2,
    }));

    const half = await build();

    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.orgGain).toBeCloseTo(full.orgGain, 6);
  });
});
