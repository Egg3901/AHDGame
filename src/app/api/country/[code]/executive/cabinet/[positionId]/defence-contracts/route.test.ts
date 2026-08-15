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
    expect((await res.json()).error).toMatch(/domestic suppliers/i);
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
