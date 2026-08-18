import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");
const ROUTE =
  "@/app/api/country/[code]/executive/cabinet/[positionId]/military/[unitId]/upgrade/route";
const UID = "507f1f77bcf86cd799439011";

function call(unitId = UID) {
  return {
    params: Promise.resolve({ code: "us", positionId: "secretary_of_defense", unitId }),
  };
}

describe("POST military/[unitId]/upgrade", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("cabinetMembers");
    db.collection("militaryUnits");
    db.collection("federalBudget");
    vi.mocked(getGameState).mockResolvedValue({ preset: "1953-default" } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
      ministerialActions: 2,
    });
    db.collectionMocks.cabinetMembers.updateOne.mockResolvedValue({ modifiedCount: 1 });
    // A real archetype: pricing reads `cost` off the unit's domain + type.
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({
      _id: "u1",
      techTier: 1,
      domain: "ground",
      type: "Infantry Division",
    });
    db.collectionMocks.militaryUnits.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000_000_000_000,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  it("upgrades the tier and spends an action", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(new Request("http://x", { method: "POST" }), call());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ techTier: 2 });
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "m1", ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
  });

  it("rejects a cutting-edge unit", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue({ _id: "u1", techTier: 3 });
    const { POST } = await import(ROUTE);
    const res = await POST(new Request("http://x", { method: "POST" }), call());
    expect(res.status).toBe(400);
  });

  it("404s when the unit is not in this country", async () => {
    db.collectionMocks.militaryUnits.findOne.mockResolvedValue(null);
    const { POST } = await import(ROUTE);
    const res = await POST(new Request("http://x", { method: "POST" }), call());
    expect(res.status).toBe(404);
  });

  // Modernising used to cost nothing but a ministerial action, while buying +8% power
  // per tier — a strictly dominant free move on every unit in the army.
  describe("treasury charge", () => {
    it("charges the treasury for the tier step", async () => {
      const { POST } = await import(ROUTE);
      const res = await POST(new Request("http://x", { method: "POST" }), call());
      expect(res.status).toBe(200);
      // US scale 2.6, Infantry Division cost 1600, target tier 2 → share 0.35.
      const expected = Math.round(387_000_000_000 * ((1600 * 0.35) / 387_000) * 2.6);
      expect(await res.json()).toMatchObject({ techTier: 2, price: expected });
      expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalled();
    });

    it("refuses and refunds the action when the country has no usable budget", async () => {
      db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);
      const { POST } = await import(ROUTE);
      const res = await POST(new Request("http://x", { method: "POST" }), call());
      expect(res.status).toBe(409);
      expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "m1" },
        { $inc: { ministerialActions: 1 } }
      );
    });

    // The guard that stops a corrupted budget doc absorbing a zero-match write and
    // handing out a free upgrade — same rule the recruit route enforces.
    it("refuses when the budget doc's countryId disagrees with its id", async () => {
      db.collectionMocks.federalBudget.findOne.mockResolvedValue({
        _id: "federal",
        countryId: "DE",
        treasuryBalance: 1_000_000_000,
        gdp: 387_000_000_000,
      });
      const { POST } = await import(ROUTE);
      expect((await POST(new Request("http://x", { method: "POST" }), call())).status).toBe(409);
      expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
    });

    it("refuses when GDP is missing rather than upgrading for free", async () => {
      db.collectionMocks.federalBudget.findOne.mockResolvedValue({
        _id: "federal",
        countryId: "US",
        treasuryBalance: 1_000_000_000,
        gdp: 0,
      });
      const { POST } = await import(ROUTE);
      expect((await POST(new Request("http://x", { method: "POST" }), call())).status).toBe(409);
      expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
    });

    // A legacy doc with no tech tier used to slip past `>= 3`, reach pricing as NaN,
    // and be refused with an unrelated "no usable GDP" message.
    it("refuses a unit whose tech tier is missing, before spending anything", async () => {
      db.collectionMocks.militaryUnits.findOne.mockResolvedValue({
        _id: "u1",
        domain: "ground",
        type: "Infantry Division",
      });
      const { POST } = await import(ROUTE);
      const res = await POST(new Request("http://x", { method: "POST" }), call());
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "This unit has no valid tech tier" });
      expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
    });

    // Modernising is paid from the defence appropriation now, so the treasury balance is
    // irrelevant to it — what binds is the pot.
    it("succeeds on an empty treasury when the appropriation covers it", async () => {
      db.collectionMocks.federalBudget.findOne.mockResolvedValue({
        _id: "federal",
        countryId: "US",
        treasuryBalance: 1,
        gdp: 387_000_000_000,
        debt: { principal: 0, ceiling: 0 },
      });
      const { POST } = await import(ROUTE);
      expect((await POST(new Request("http://x", { method: "POST" }), call())).status).toBe(200);
    });

    it("debits the appropriation, not the treasury", async () => {
      const { POST } = await import(ROUTE);
      await POST(new Request("http://x", { method: "POST" }), call());
      const potMoves = db.collectionMocks.federalBudget.updateOne.mock.calls.filter(
        (c) =>
          (c[1] as { $inc?: Record<string, number> })?.$inc?.["defenseAppropriation.balance"] !=
          null
      );
      expect(potMoves).toHaveLength(1);
      const treasuryWrites = db.collectionMocks.federalBudget.updateOne.mock.calls.filter(
        (c) => (c[1] as { $set?: Record<string, unknown> })?.$set?.treasuryBalance !== undefined
      );
      expect(treasuryWrites).toHaveLength(0);
    });

    // No overdraft for modernisation either — the overdraft is for upkeep obligations.
    it("refuses when the appropriation is short and refunds the action", async () => {
      db.collectionMocks.federalBudget.updateOne.mockImplementation(
        async (filter: Record<string, unknown>) => {
          const guarded = filter.$expr !== undefined;
          return { matchedCount: guarded ? 0 : 1, modifiedCount: guarded ? 0 : 1 };
        }
      );
      const { POST } = await import(ROUTE);
      const res = await POST(new Request("http://x", { method: "POST" }), call());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/appropriation/i);
      expect(db.collectionMocks.militaryUnits.updateOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "m1" },
        { $inc: { ministerialActions: 1 } }
      );
    });
  });
});
