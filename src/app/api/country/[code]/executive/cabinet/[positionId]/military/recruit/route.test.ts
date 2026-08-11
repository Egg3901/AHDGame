import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/military/recruit/route";

function req(body: unknown) {
  return new Request(
    "http://localhost/api/country/us/executive/cabinet/secretary_of_defense/military/recruit",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}
const params = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("POST military/recruit", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 42, preset: "2019-default" } as never);

    db.collection("cabinetMembers");
    db.collection("states");
    db.collection("militaryUnits");
    db.collection("nationalManpower");
    db.collection("federalBudget");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      characterId: "char_1",
      ministerialActions: 1,
    });
    db.collectionMocks.cabinetMembers.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "CA" });
    db.collectionMocks.militaryUnits.insertOne.mockResolvedValue({ acknowledged: true });
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 500_000,
      mode: "trained",
    });
    db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ population: 100_000_000 }],
    });
    // Keyed by country on purpose. A blanket `{ countryId: "US" }` mock would be
    // handed back for `ensureFederalBudget(db, "DE", …)` too, and the
    // countryId-mismatch guard would then 409 the two pre-existing DE cases.
    db.collectionMocks.federalBudget.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        // getNationalBudgetId maps US -> "federal" and every other country to its
        // own code, so "DE" arrives here as both the _id and the countryId key.
        const id = (filter?._id ?? filter?.countryId) as string | undefined;
        const countryId = id === "DE" ? "DE" : "US";
        return {
          _id: countryId,
          countryId,
          treasuryBalance: 10_000_000_000,
          gdp: 387_000_000_000,
          debt: { principal: 0, ceiling: 0 },
        };
      }
    );
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    // An EMPTY arsenal by default. The generic mock's `updateOne` resolves to
    // modifiedCount 1, which would make `drawLots`' guarded `$inc` succeed against a store
    // that holds nothing — every unit would come out fully equipped from an empty arsenal
    // and the hollow-formation path would never be exercised.
    db.collection("nationalArsenal");
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue(null);
    db.collectionMocks.nationalArsenal.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
  });

  it("recruits a unit and spends an action", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      req({ branchId: "army", type: "Infantry Division", name: "3rd Vanguard" }),
      params
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryUnits.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "US",
        branchId: "army",
        domain: "ground",
        type: "Infantry Division",
        posture: "standard",
        // techTier and equipment now come from the arsenal rather than being hardcoded to
        // 1 / {1,1,1}. This fixture has no arsenal document, so the unit is raised hollow —
        // which is the designed behaviour, not a refusal.
        techTier: 0,
        equipment: { firepower: 0, protection: 0, support: 0 },
        vet: 1,
        theaterId: "reserve",
        assignedGeneralId: null,
      })
    );
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "member_1", ministerialActions: { $gte: 1 } },
      { $inc: { ministerialActions: -1 } }
    );
  });

  it("rejects when no actions remain", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      characterId: "char_1",
      ministerialActions: 0,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(400);
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a non-holder non-admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "someone_else" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(403);
  });

  it("rejects an invalid branch", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "nope", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(400);
  });

  it("404s for a non-defense position", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }),
    });
    expect(res.status).toBe(404);
  });

  // Bundeswehr stood up Nov 1955 (bundeswehr.de). A 1953 world must reject Heer
  // until the live year reaches 1955 — seed gating alone is not enough.
  it("rejects a branch whose establishedYear is after the live game year", async () => {
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 1,
      currentYear: 1953,
      startingYear: 1953,
      preset: "1953-default",
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(
      new Request(
        "http://localhost/api/country/de/executive/cabinet/defense_minister/military/recruit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: "heer",
            type: "Infantry Division",
            name: "1. Panzergrenadier",
          }),
        }
      ),
      { params: Promise.resolve({ code: "de", positionId: "defense_minister" }) }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Branch is not available in 1953" });
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
  });

  it("accepts the same branch once the live game year reaches its establishedYear", async () => {
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 97,
      currentYear: 1955,
      startingYear: 1953,
      preset: "1953-default",
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(
      new Request(
        "http://localhost/api/country/de/executive/cabinet/defense_minister/military/recruit",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId: "heer",
            type: "Infantry Division",
            name: "1. Panzergrenadier",
          }),
        }
      ),
      { params: Promise.resolve({ code: "de", positionId: "defense_minister" }) }
    );
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryUnits.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        countryId: "DE",
        branchId: "heer",
        domain: "ground",
        type: "Infantry Division",
      })
    );
  });

  it("draws manpower and debits the defence appropriation", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      req({ branchId: "army", type: "Infantry Division", name: "3rd Vanguard" }),
      params
    );
    expect(res.status).toBe(200);

    // Infantry Division: 12,000 personnel, cost 1600M, US scale 2.6 → $4.16bn
    expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
      { countryId: "US", pool: { $gte: 12000 } },
      { $inc: { pool: -12000 } }
    );
    // Guarded atomic $inc on the pot, NOT a read-modify-write $set on treasuryBalance:
    // the enacted defence line has already left the treasury via processTreasuryTurn, so
    // charging it here as well would bill the country twice for the same unit.
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledWith(
      { countryId: "US", "defenseAppropriation.balance": { $gte: 4_160_000_000 } },
      { $inc: { "defenseAppropriation.balance": -4_160_000_000 } }
    );
    const treasuryWrites = db.collectionMocks.federalBudget.updateOne.mock.calls.filter(
      (c) => (c[1] as { $set?: Record<string, unknown> })?.$set?.treasuryBalance !== undefined
    );
    expect(treasuryWrites).toHaveLength(0);
  });

  // Procurement gets no overdraft: that is reserved for upkeep, an obligation already
  // incurred. A new order must fit inside the balance outright.
  it("refuses when the appropriation cannot cover the price, and unwinds cleanly", async () => {
    db.collectionMocks.federalBudget.updateOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        const guarded = filter["defenseAppropriation.balance"] !== undefined;
        return { matchedCount: guarded ? 0 : 1, modifiedCount: guarded ? 0 : 1 };
      }
    );
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/appropriation/i);
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
    // Manpower returned and the ministerial action refunded — nothing left spent.
    expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
      { countryId: "US", pool: { $lte: expect.any(Number) } },
      { $inc: { pool: 12000 } }
    );
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "member_1" },
      { $inc: { ministerialActions: 1 } }
    );
  });

  it("refuses rather than gifting a free unit when no budget can be seeded", async () => {
    // Mocking findOne -> null is NOT enough on its own: for a country that HAS a
    // seed (US/2019), ensureFederalBudget would insert one and only return null
    // because the re-read hits the same null mock — passing for the wrong reason
    // and never exercising the no-seed path. Stub the seed lookup so the country
    // genuinely has no default budget.
    vi.doMock("@/lib/seeds/reference/budgets", () => ({
      getInitialNationalBudgetsForPreset: () => [],
    }));
    db.collectionMocks.federalBudget.findOne.mockResolvedValue(null);

    try {
      const { POST } = await import(ROUTE);
      const res = await POST(
        req({ branchId: "army", type: "Infantry Division", name: "X" }),
        params
      );
      expect(res.status).toBe(409);
      expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
      // Checked before any resource moves, so no manpower is drawn at all.
      expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
      // The ministerial action is still refunded.
      expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
        { _id: "member_1" },
        { $inc: { ministerialActions: 1 } }
      );
    } finally {
      // The file has no vi.resetModules(), so a failed assertion above must not
      // leak the stub into later cases.
      vi.doUnmock("@/lib/seeds/reference/budgets");
    }
  });

  it("scales the debit by the country's own GDP, not any exchange rate", async () => {
    // Same archetype, a 10x larger economy -> a 10x larger charge, in whatever
    // units that budget is denominated in.
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      treasuryBalance: 1e14,
      gdp: 3_870_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledWith(
      { countryId: "US", "defenseAppropriation.balance": { $gte: 41_600_000_000 } },
      { $inc: { "defenseAppropriation.balance": -41_600_000_000 } }
    );
  });

  it("refuses when the budget has no usable GDP", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      treasuryBalance: 1e10,
      gdp: 0,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
  });

  it("refuses when the healed budget belongs to a different country", async () => {
    // ensureFederalBudget looks up by `_id: getNationalBudgetId(countryId)`
    // (ensureFederalBudget.ts:65) but moveTreasury reads and writes by
    // `{ countryId }` (treasurySpend.ts:27-29, 52-55). A doc whose countryId
    // field disagrees with its _id — the corruption
    // `findFederalBudgetCountryMismatches` exists to detect — passes a non-null
    // check and then absorbs a zero-match update. That is a free unit.
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "US",
      countryId: "GB",
      treasuryBalance: 1e10,
      gdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
  });

  it("rejects with 400 when the pool is too small", async () => {
    db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
      countryId: "US",
      pool: 10,
      mode: "trained",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/insufficient manpower/i),
    });
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "member_1" },
      { $inc: { ministerialActions: 1 } }
    );
  });

  it("rejects with 409 when the atomic guard loses a race", async () => {
    // Pool reads ample, but the guarded decrement matches nothing.
    db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.militaryUnits.insertOne).not.toHaveBeenCalled();
  });

  // Not in the plan, but this is the one path with no transaction behind it:
  // three resources are already spent when the insert fails, and each has its own
  // compensating write. A partial unwind mints or destroys resources silently.
  it("unwinds the appropriation, manpower and the action when the insert fails", async () => {
    db.collectionMocks.militaryUnits.insertOne.mockRejectedValue(new Error("insert exploded"));
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(500);

    // Debit and credit are equal and opposite. The credit is deliberately UNGUARDED —
    // a refused rollback would leave the player charged for a unit they never received.
    const potMoves = db.collectionMocks.federalBudget.updateOne.mock.calls
      .map((c) => (c[1] as { $inc?: Record<string, number> })?.$inc)
      .filter((inc): inc is Record<string, number> => inc?.["defenseAppropriation.balance"] != null)
      .map((inc) => inc["defenseAppropriation.balance"]);
    expect(potMoves).toEqual([-4_160_000_000, 4_160_000_000]);
    // Manpower returned (guarded $inc, not a read-modify-write).
    expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
      { countryId: "US", pool: { $lte: expect.any(Number) } },
      { $inc: { pool: 12000 } }
    );
    // Ministerial action refunded.
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "member_1" },
      { $inc: { ministerialActions: 1 } }
    );
  });

  // Recruiting used to borrow against the national treasury without limit. It now spends a
  // finite appropriation, so an empty treasury is irrelevant — what matters is the pot.
  it("succeeds on an empty treasury when the appropriation covers the price", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      treasuryBalance: 1_000_000,
      gdp: 1_000_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(200);
    expect(db.collectionMocks.militaryUnits.insertOne).toHaveBeenCalled();
  });

  // An empty store must never block the order — it degrades what the unit is issued with.
  it("raises a hollow unit from an empty arsenal rather than refusing", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(res.status).toBe(200);
    const inserted = db.collectionMocks.militaryUnits.insertOne.mock.calls[0][0];
    expect(inserted.equipment).toEqual({ firepower: 0, protection: 0, support: 0 });
    expect(inserted.techTier).toBe(0);
  });

  it("issues equipment at the arsenal's grade when the store can fill the order", async () => {
    db.collection("nationalArsenal");
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      countryId: "US",
      stock: { ground: 9_999, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 2, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    db.collectionMocks.nationalArsenal.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    const { POST } = await import(ROUTE);
    await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    const inserted = db.collectionMocks.militaryUnits.insertOne.mock.calls[0][0];
    expect(inserted.techTier).toBe(2);
    expect(inserted.equipment.firepower).toBeGreaterThan(0);
  });

  it("draws the lots it issues out of the store", async () => {
    db.collection("nationalArsenal");
    db.collectionMocks.nationalArsenal.findOne.mockResolvedValue({
      countryId: "US",
      stock: { ground: 9_999, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
      grade: { ground: 1, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
    });
    db.collectionMocks.nationalArsenal.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    const { POST } = await import(ROUTE);
    await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    const drew = db.collectionMocks.nationalArsenal.updateOne.mock.calls.some((c) => {
      const inc = (c[1] as { $inc?: Record<string, number> }).$inc ?? {};
      return (inc["stock.ground"] ?? 0) < 0;
    });
    expect(drew).toBe(true);
  });

  it("prices against the anchored GDP when a baseline is recorded", async () => {
    // gdp has grown 4x since the baseline, so the anchor is sqrt(4)=2x the baseline —
    // the price doubles rather than quadrupling, which is what makes growth pay off.
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "US",
      countryId: "US",
      treasuryBalance: 1e14,
      gdp: 4 * 387_000_000_000,
      militaryPriceBaselineGdp: 387_000_000_000,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    await POST(req({ branchId: "army", type: "Infantry Division", name: "X" }), params);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledWith(
      { countryId: "US", "defenseAppropriation.balance": { $gte: 2 * 4_160_000_000 } },
      { $inc: { "defenseAppropriation.balance": -2 * 4_160_000_000 } }
    );
  });
});
