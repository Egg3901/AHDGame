import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import { SETTLEMENT_INSTITUTIONS, SETTLEMENT_SEATS } from "@/lib/constants/settlementCrisis";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("../actorContext", () => ({ loadSettlementActorContext: vi.fn() }));
vi.mock("../playCost", () => ({
  seatFundsLocal: vi.fn(),
  resolvePersonalFunds: vi.fn(),
}));
vi.mock("@/lib/budget/treasurySpend", () => ({ spendFromTreasury: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(412) }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const CRISIS_ID = new ObjectId();
const characterId = new ObjectId();

function seatCtx(over: Record<string, unknown> = {}) {
  return {
    crisisId: CRISIS_ID.toString(),
    seat: {
      id: "DD",
      role: "headOfGovernment",
      direction: 1,
      budget: { actionsPerTurn: 3, actionsRemaining: 3, capital: 30 },
      canAct: true,
      blockedReason: null,
      ...over,
    },
    personal: { actionsRemaining: 5 },
  };
}

describe("commitSettlementPlay", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    prime(db, "settlementCrises").findOne.mockResolvedValue({
      _id: CRISIS_ID,
      status: "open",
      institutions: SETTLEMENT_INSTITUTIONS.map((i) => ({ id: i.id, weight: i.weight })),
      seats: SETTLEMENT_SEATS.map((s) => ({ id: s.id })),
    });
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "characters").findOne.mockResolvedValue({
      _id: characterId,
      actions: 5,
      funds: 1_000_000,
    });
    prime(db, "characters").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 10_000_000_000 });
    prime(db, "settlementPlays").insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(seatCtx() as never);
    const { seatFundsLocal } = await import("../playCost");
    vi.mocked(seatFundsLocal).mockReturnValue(45_000_000);
    const { resolvePersonalFunds } = await import("../playCost");
    vi.mocked(resolvePersonalFunds).mockResolvedValue({
      local: 5_000,
      field: "funds",
      balanceLocal: 1_000_000,
    });
  });

  it("refuses when the feature gate is off", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(null);
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 404 });
  });

  it("refuses an unknown play id", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "nonesuch",
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a seat play from a character with no seat", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue({
      crisisId: CRISIS_ID.toString(),
      seat: null,
      personal: { actionsRemaining: 5 },
    } as never);
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a play belonging to a different seat", async () => {
    // The GDR seat cannot play Washington's credit line.
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "credit",
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a seat whose country is in neither bloc", async () => {
    const { loadSettlementActorContext } = await import("../actorContext");
    vi.mocked(loadSettlementActorContext).mockResolvedValue(
      seatCtx({ direction: null, canAct: false, blockedReason: "no-direction" }) as never
    );
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });

  it("ignores a client-supplied direction on a seat play and uses the bloc's", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
      direction: -1,
    });
    expect(res).toMatchObject({ ok: true, appliedDirection: 1 });
    const doc = prime(db, "settlementPlays").insertOne.mock.calls[0][0];
    expect(doc.direction).toBe(1);
  });

  it("refuses a seat play the treasury cannot cover, before debiting anything", async () => {
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: 1_000 });
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 402 });
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    expect(vi.mocked(spendFromTreasury)).not.toHaveBeenCalled();
    expect(prime(db, "settlementCrises").updateOne).not.toHaveBeenCalled();
    expect(prime(db, "settlementPlays").insertOne).not.toHaveBeenCalled();
  });

  it("debits the seat with a guarded $inc on the crisis document", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    const [filter, update] = prime(db, "settlementCrises").updateOne.mock.calls[0];
    expect(filter.seats.$elemMatch).toMatchObject({
      id: "DD",
      capital: { $gte: 0 },
      actionsUsedTurn: { $lte: 2 },
    });
    expect(update.$inc["seats.$.actionsUsedTurn"]).toBe(1);
  });

  it("charges the treasury only after winning the guarded claim", async () => {
    prime(db, "settlementCrises").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    expect(vi.mocked(spendFromTreasury)).not.toHaveBeenCalled();
    expect(prime(db, "settlementPlays").insertOne).not.toHaveBeenCalled();
  });

  it("queues the play unresolved for the turn phase", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    const doc = prime(db, "settlementPlays").insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({
      actor: "seat",
      seatId: "DD",
      playId: "aid",
      targetInstitutionId: "laender",
      resolvedTurn: null,
      appliedPoints: null,
      heatAdded: 0,
      turn: 412,
    });
    expect(doc.basePoints).toBe(400);
  });

  it("stamps heat on a coercive play", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "border",
    });
    const doc = prime(db, "settlementPlays").insertOne.mock.calls[0][0];
    expect(doc.heatAdded).toBe(1);
  });

  it("requires an explicit direction on a personal play", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "oped",
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("lets a personal play push either way regardless of the actor's bloc", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "oped",
      direction: 1,
    });
    expect(res).toMatchObject({ ok: true, appliedDirection: 1 });
    const doc = prime(db, "settlementPlays").insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({ actor: "personal", seatId: null, direction: 1 });
  });

  it("refuses a seat-only play attempted personally", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "aid",
      direction: 1,
    });
    expect(res).toMatchObject({ ok: false, status: 403 });
  });

  it("debits the character with a guarded $inc on both actions and funds", async () => {
    const { commitSettlementPlay } = await import("./commitPlay");
    await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "rally",
      direction: -1,
    });
    const [filter, update] = prime(db, "characters").updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: characterId, actions: { $gte: 2 } });
    expect(filter.funds).toEqual({ $gte: 5_000 });
    expect(update.$inc).toMatchObject({ actions: -2, funds: -5_000 });
  });

  it("records what was actually charged, not the anchor figure", async () => {
    const { resolvePersonalFunds } = await import("../playCost");
    vi.mocked(resolvePersonalFunds).mockResolvedValue({
      local: 20_000,
      field: "currencyBalances.campaign",
      balanceLocal: 1_000_000,
    });
    const { commitSettlementPlay } = await import("./commitPlay");
    await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "rally",
      direction: 1,
    });
    const doc = prime(db, "settlementPlays").insertOne.mock.calls[0][0];
    // The catalogue says 5,000 anchor; the player watched 20,000 local leave.
    expect(doc.costs.funds).toBe(20_000);
  });

  it("refuses when the guarded character debit matches nothing", async () => {
    prime(db, "characters").updateOne.mockResolvedValue({ matchedCount: 0 });
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "personal",
      playId: "rally",
      direction: 1,
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(prime(db, "settlementPlays").insertOne).not.toHaveBeenCalled();
  });

  it("refuses a play against a frozen crisis", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue({
      _id: CRISIS_ID,
      status: "frozen",
      institutions: [],
      seats: [],
    });
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: false, status: 409 });
  });
});
