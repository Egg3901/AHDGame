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

describe("DELETE defence-contracts", () => {
  let db: MockDb;
  const CONTRACT_ID = new ObjectId();
  const RIVAL_CORP_ID = new ObjectId();
  const MINISTER_CHAR_ID = new ObjectId();

  /** A live order the supplier accepted: 10 lots at 1,000, one delivered. */
  const liveContract = (over: Record<string, unknown> = {}) => ({
    _id: CONTRACT_ID,
    countryId: "US",
    corporationId: RIVAL_CORP_ID,
    sectorId: new ObjectId(),
    component: "ground",
    status: "active",
    lotsOrdered: 10,
    lotsDelivered: 1,
    pricePerLot: 1_000,
    encumberedAmount: 9_000,
    allocationWindowId: "US:0",
    allocatedLots: 10,
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        userId: new ObjectId(),
        character: { _id: MINISTER_CHAR_ID, name: "Ren Todoroki" },
      },
    } as never);
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 5, preset: "1953-default" } as never);

    db.collection("cabinetMembers");
    db.collection("defenceContracts");
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("federalBudget");
    db.collection("characters");
    db.collection("defenceProcurementAllocations");

    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "m1",
      characterId: MINISTER_CHAR_ID.toString(),
    });
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(liveContract());
    db.collectionMocks.defenceContracts.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: RIVAL_CORP_ID,
      countryId: "US",
      name: "Northrop",
      userId: new ObjectId(),
    });
    // The appropriation can cover the break fee unless a test says otherwise.
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      gdp: 500_000_000_000,
      defenseAppropriation: { balance: 5_000_000, encumbered: 9_000, accruedThroughTurn: 4 },
      spending: { defense: 1_000_000 },
    });
    db.collectionMocks.federalBudget.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  const del = (id: string) =>
    new Request(`http://localhost/api/x/defence-contracts?contractId=${id}`, { method: "DELETE" });

  async function cancel() {
    const { DELETE } = await import(ROUTE);
    const res = await DELETE(del(CONTRACT_ID.toString()), params);
    return { status: res.status, body: await res.json() };
  }

  it("cancels the country's own contract", async () => {
    const r = await cancel();
    expect(r.status).toBe(200);
    expect(r.body.cancelled).toBe(true);
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

  // The reported abuse: a minister tears up a rival's live order for nothing. It now pays the
  // supplier the margin it was promised on the lots it will never build.
  it("charges a break fee for tearing up a contract the supplier accepted", async () => {
    const r = await cancel();
    expect(r.status).toBe(200);
    expect(r.body.basis).toBe("convenience");
    expect(r.body.terminationFee).toBeGreaterThan(0);
  });

  // A closed order whose fee never moved is a repair item, not a settled record, and the
  // supplier must not be told they were compensated.
  it("records whether the fee actually landed", async () => {
    const r = await cancel();
    expect(r.body).toHaveProperty("terminationFeePaid");
    const feeWrites = db.collectionMocks.defenceContracts.updateOne.mock.calls.filter((c) =>
      JSON.stringify(c[1]).includes("termination.feePaid")
    );
    expect(feeWrites).toHaveLength(1);
  });

  it("costs nothing to withdraw an offer the supplier never answered", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(
      liveContract({ status: "pending", lotsDelivered: 0 })
    );
    const r = await cancel();
    expect(r.body.basis).toBe("withdrawal");
    expect(r.body.terminationFee).toBe(0);
    expect(r.body.favorabilityPenalty).toBe(0);
  });

  it("costs nothing to drop a plant that has stopped delivering", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(
      liveContract({ supplierFaultTurns: 3 })
    );
    const r = await cancel();
    expect(r.body.basis).toBe("cause");
    expect(r.body.terminationFee).toBe(0);
  });

  // The appropriation is the supplier's only security. A minister who cannot pay the fee does
  // not get to tear the contract up and leave the company holding the bill.
  it("refuses the termination when the appropriation cannot pay the fee", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      gdp: 500_000_000_000,
      defenseAppropriation: { balance: 1, encumbered: 0, accruedThroughTurn: 4 },
      spending: { defense: 1_000_000 },
    });
    const r = await cancel();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/break fees/i);
  });

  it("charges the minister's own standing for a convenience termination", async () => {
    const r = await cancel();
    expect(r.body.favorabilityPenalty).toBeGreaterThan(0);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalled();
  });

  it("leaves the minister's standing alone when the plant was not building", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(
      liveContract({ supplierFaultTurns: 5 })
    );
    const r = await cancel();
    expect(r.body.favorabilityPenalty).toBe(0);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  // The loop: cancel a rival mid-window and re-award the freed quota to your own plant. A
  // convenience termination leaves the tranche spent, so the room does not come back.
  it("does not hand the window quota back after a convenience termination", async () => {
    await cancel();
    expect(db.collectionMocks.defenceProcurementAllocations.updateOne).not.toHaveBeenCalled();
  });

  it("hands the window quota back when the offer was never accepted", async () => {
    db.collectionMocks.defenceContracts.findOne.mockResolvedValue(
      liveContract({ status: "pending", lotsDelivered: 0 })
    );
    await cancel();
    expect(db.collectionMocks.defenceProcurementAllocations.updateOne).toHaveBeenCalled();
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
describe("retired direct defence awards", () => {
  it("returns 410 without creating or reserving a contract", async () => {
    const { POST } = await import(ROUTE);
    const result = await POST();
    expect(result.status).toBe(410);
    expect((await result.json()).error).toMatch(/bidding/);
  });
});
