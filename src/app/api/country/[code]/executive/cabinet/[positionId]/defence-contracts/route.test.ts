import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");
const { getGameState } = await import("@/lib/gameState");

const ROUTE = "@/app/api/country/[code]/executive/cabinet/[positionId]/defence-contracts/route";

const SECTOR_ID = new ObjectId();
const CORP_ID = new ObjectId();

function req(body: unknown) {
  return new Request("http://localhost/api/country/us/x/y/defence-contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ code: "us", positionId: "secretary_of_defense" }) };

describe("POST defence-contracts", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5, preset: "1953-default" } as never);

    db.collection("cabinetMembers");
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collection("federalBudget");
    db.collection("defenceContracts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "munitions",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 387_000_000_000,
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
    });
    db.collectionMocks.defenceContracts.insertOne.mockResolvedValue({ acknowledged: true });
  });

  it("awards a contract against a domestic defence plant", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract.component).toBe("ground");
    expect(body.contract.lotsOrdered).toBe(1);
    expect(body.contract.pricePerLot).toBeGreaterThan(0);
  });

  // Ticket #1134: a two-domain plant can fill either domain, not only components[0].
  it("awards the minister's chosen domain on a plant that serves two", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "standard",
      countryId: "US",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(
      req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1, component: "air" }),
      params
    );
    expect(res.status).toBe(200);
    expect((await res.json()).contract.component).toBe("air");
  });

  it("refuses a domain the plant is not certified for", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(
      req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1, component: "naval" }),
      params
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not naval/i);
  });

  it("rejects an award larger than the supplier's budget-scaled contracting allowance", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1_000 }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/at most|maximum|allowance|available/i);
    expect(db.collectionMocks.defenceContracts.insertOne).not.toHaveBeenCalled();
  });

  // A National Corporation has no player CEO to click Accept. Leaving the offer pending
  // meant Soviet (and every other command-economy) arsenal contracts never delivered.
  it("activates a contract awarded to a state-owned supplier", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).contract.status).toBe("active");
  });

  it("leaves a private supplier's contract pending the CEO's answer", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).contract.status).toBe("pending");
  });

  // Kill switch: a frozen world refuses new awards before touching the order book, and the
  // supplier is never notified of an offer that was never made.
  it("refuses to award while defence procurement is frozen", async () => {
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      defenceProcurementPaused: true,
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/frozen/i);
    expect(db.collectionMocks.defenceContracts.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a non-holder", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "someone_else" } },
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(403);
  });

  it("rejects a position that is not the defence seat", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), {
      params: Promise.resolve({ code: "us", positionId: "secretary_of_treasury" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a non-defence plant", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "technology",
      strategyId: "standard",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(400);
  });

  // `cyber` supplies electronics and software, not materiel. Awarding it a contract would
  // create an order it could never fill.
  it("rejects a plant whose line builds no materiel", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "cyber",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not build materiel/i);
  });

  it("rejects a foreign supplier", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "UK",
      liquidCurrencyCode: "GBP",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(400);
    // The shared fill resolver names the exact refusal now, rather than one message for
    // every domestic-supplier rule at once.
    expect((await res.json()).error).toMatch(/not in the buying country/i);
  });

  // Refused at award, not discovered later as a permanently stalled contract.
  it("rejects a supplier whose currency does not match the country's", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "GBP",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(400);
  });

  it("refuses rather than pricing at zero when the budget has no usable GDP", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 0,
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(409);
    expect(db.collectionMocks.defenceContracts.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a malformed sector id and a non-positive order", async () => {
    const { POST } = await import(ROUTE);
    expect((await POST(req({ sectorId: "nope", lotsOrdered: 10 }), params)).status).toBe(400);
    expect(
      (await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 0 }), params)).status
    ).toBe(400);
  });

  // Prices inherit C1's anchoring, so a growing economy outruns them.
  it("prices against the anchored GDP when a baseline is recorded", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 4 * 387_000_000_000,
      militaryPriceBaselineGdp: 387_000_000_000,
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
    });
    const { POST } = await import(ROUTE);
    const anchored = await (
      await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params)
    ).json();

    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 4 * 387_000_000_000,
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
    });
    const live = await (
      await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params)
    ).json();

    // GDP quadrupled; the anchor only doubles it, so the anchored price is lower.
    expect(anchored.contract.pricePerLot).toBeLessThan(live.contract.pricePerLot);
  });
});

describe("DELETE defence-contracts", () => {
  let db: MockDb;
  const CONTRACT_ID = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    db.collection("cabinetMembers");
    db.collection("defenceContracts");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue({
      _id: CONTRACT_ID,
      countryId: "US",
      status: "active",
    });
    db.collectionMocks.defenceContracts.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  const del = (id: string) =>
    new Request(`http://localhost/api/x/defence-contracts?contractId=${id}`, { method: "DELETE" });

  it("cancels the country's own contract", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del(CONTRACT_ID.toString()), params);
    expect(res.status).toBe(200);
    expect((await res.json()).cancelled).toBe(true);
  });

  // Without the country scope a minister could cancel another nation's contracts by id.
  it("cannot reach a contract belonging to another country", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(null);
    const { DELETE } = await import(ROUTE);
    expect((await DELETE(del(CONTRACT_ID.toString()), params)).status).toBe(404);
  });

  it("requires a contract id", async () => {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(
      new Request("http://localhost/api/x/defence-contracts", { method: "DELETE" }),
      params
    );
    expect(res.status).toBe(400);
  });
});

/**
 * The obligation model, at the route.
 *
 * This is the guard that closes the appropriation-drain exploit: a minister could order up to
 * a million lots because NOTHING checked the order against the money until delivery, and then
 * the appropriation was paid out to the supplier lot by lot until it was empty. An award must
 * now commit its full cost up front, and be refused outright when that money is not there.
 */
describe("POST defence-contracts - the obligation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5, preset: "1953-default" } as never);

    db.collection("cabinetMembers");
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collection("federalBudget");
    db.collection("defenceContracts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "munitions",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 387_000_000_000,
      spending: { byCategory: { defense: 65_081_266_164.8 } },
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
      defenseAppropriation: {
        balance: 10_000_000_000,
        encumbered: 0,
        accruedThroughTurn: 1,
        arrearsRatio: 0,
      },
    });
    db.collectionMocks.defenceContracts.insertOne.mockResolvedValue({ acknowledged: true });
    db.collectionMocks.defenceContracts.find.mockReturnValue({
      toArray: async () => [],
      sort: () => ({ toArray: async () => [] }),
    } as never);
  });

  it("commits the full cost of the order against the appropriation at award", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 2 }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract.encumberedAmount).toBe(
      body.contract.lotsOrdered * body.contract.pricePerLot
    );

    // The commitment is an `encumbered` increment on the country's appropriation, not a debit:
    // nothing is paid until a lot is actually delivered.
    const calls = db.collectionMocks.federalBudget.updateOne.mock.calls;
    const encumber = calls.find(
      (c: unknown[]) =>
        (c[1] as { $inc?: Record<string, number> })?.$inc?.["defenseAppropriation.encumbered"] !=
        null
    );
    expect(encumber).toBeDefined();
    expect(
      (encumber![1] as { $inc: Record<string, number> }).$inc["defenseAppropriation.encumbered"]
    ).toBe(body.contract.encumberedAmount);
  });

  // THE EXPLOIT. An order the appropriation cannot cover is refused at the door rather than
  // accepted and paid out until the budget is gone.
  it("refuses an order the uncommitted appropriation cannot cover", async () => {
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 2 }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/uncommitted/i);
    expect(db.collectionMocks.defenceContracts.insertOne).not.toHaveBeenCalled();
  });

  // Ticket #1134. Command economies have one defence SOE. The private one-third cap
  // would leave two thirds of the window unspendable and every other plant idle.
  it("lets a state-owned supplier take more than one third of the national window", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).contract.lotsOrdered).toBe(10);
  });

  it("still caps a private supplier at one third of the window", async () => {
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 10 }), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.maximumLots).toBeLessThan(10);
    expect(body.error).toMatch(/at most/i);
  });

  it("assigns every free production line when the supplier is state-owned", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "standard",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    const { POST } = await import(ROUTE);
    const res = await POST(req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1 }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).contract.assignedFactories).toBe(4);
  });
});

/** Suggestion #291 and #292: the minister's price and grade, bounded server-side. */
describe("POST defence-contracts - minister-set price and grade", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: "char_1" } },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5, preset: "1953-default" } as never);

    db.collection("cabinetMembers");
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collection("federalBudget");
    db.collection("defenceContracts");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: "char_1",
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: SECTOR_ID,
      corporationId: CORP_ID,
      sectorType: "defense",
      strategyId: "munitions",
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      countryId: "US",
      gdp: 387_000_000_000,
      spending: { byCategory: { defense: 65_081_266_164.8 } },
      treasuryBalance: 0,
      debt: { principal: 0, ceiling: 0 },
      defenseAppropriation: {
        balance: 10_000_000_000,
        encumbered: 0,
        accruedThroughTurn: 1,
        arrearsRatio: 0,
      },
    });
    db.collectionMocks.defenceContracts.insertOne.mockResolvedValue({ acknowledged: true });
    db.collectionMocks.defenceContracts.find.mockReturnValue({
      toArray: async () => [],
      sort: () => ({ toArray: async () => [] }),
    } as never);
  });

  async function priceOf(body: Record<string, unknown>) {
    const { POST } = await import(ROUTE);
    const res = await POST(
      req({ sectorId: SECTOR_ID.toString(), lotsOrdered: 1, ...body }),
      params
    );
    return { status: res.status, body: await res.json() };
  }

  it("quotes a fair price when the minister sets none", async () => {
    const r = await priceOf({});
    expect(r.status).toBe(200);
    expect(r.body.contract.pricePerLot).toBeGreaterThan(0);
  });

  // Above the ceiling the appropriation is a private cash tap; the client's own bounds are a
  // convenience and never the enforcement.
  it("refuses a price above the GDP-anchored ceiling", async () => {
    const fair = (await priceOf({})).body.contract.pricePerLot;
    const r = await priceOf({ pricePerLot: fair * 100 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must be priced between/i);
    expect(r.body.priceBand.ceiling).toBeGreaterThan(0);
  });

  // Below the floor the supplier builds at a loss it never agreed to, and the arsenal is
  // filled by confiscation rather than by contract.
  it("refuses a price below production cost plus a margin", async () => {
    const r = await priceOf({ pricePerLot: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must be priced between/i);
  });

  it("accepts a price inside the band and stores it", async () => {
    const band = (await priceOf({ pricePerLot: 1 })).body.priceBand;
    const inside = Math.round((band.floor + band.ceiling) / 2);
    const r = await priceOf({ pricePerLot: inside });
    expect(r.status).toBe(200);
    expect(r.body.contract.pricePerLot).toBe(inside);
  });

  // Suggestion #292. Asking for premium kit from a corporation whose research tops out lower
  // would price the contract as premium and deliver legacy materiel.
  it("caps the ordered grade at what the supplier can actually build", async () => {
    const r = await priceOf({ gradeCeiling: 3 });
    expect(r.status).toBe(200);
    // This corporation has researched nothing, so its ceiling is 0.
    expect(r.body.contract.gradeCeiling).toBe(0);
  });

  it("prices a cheap grade below a premium one", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      unlockedTechNodeIds: [],
    });
    const cheap = await priceOf({ gradeCeiling: 0 });
    expect(cheap.status).toBe(200);
    expect(cheap.body.contract.pricePerLot).toBeGreaterThan(0);
  });
});
