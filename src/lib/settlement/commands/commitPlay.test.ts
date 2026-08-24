import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";
import {
  SETTLEMENT_INSTITUTIONS,
  SETTLEMENT_SEATS,
  getPlay,
} from "@/lib/constants/settlementCrisis";

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
      budget: { actionsPerTurn: 3, actionsRemaining: 3, actionsBankCap: 9, capital: 30 },
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
    // Nothing played yet this turn. Explicit rather than relying on an
    // unstubbed mock returning undefined.
    prime(db, "settlementPlays").countDocuments.mockResolvedValue(0);

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

  it("commits a seat play against a treasury already in debt", async () => {
    // `treasuryBalance` is the SIGNED national cash position: negative IS the
    // national debt, and `debt.principal` mirrors max(0, -balance). Refusing on
    // `balance < cost` therefore locked every country carrying debt out of every
    // funded play, which is what player suggestion S#308 reported.
    prime(db, "federalBudget").findOne.mockResolvedValue({ treasuryBalance: -500_000_000 });
    const { commitSettlementPlay } = await import("./commitPlay");
    const res = await commitSettlementPlay(db as unknown as Db, {
      characterId,
      actor: "seat",
      playId: "aid",
    });
    expect(res).toMatchObject({ ok: true });
    // `spendFromTreasury` splits the spend into fromSurplus/addedToDebt itself,
    // so borrowing is modelled rather than refused.
    const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
    expect(vi.mocked(spendFromTreasury)).toHaveBeenCalledWith(expect.anything(), "DD", 45_000_000);
    expect(prime(db, "settlementCrises").updateOne).toHaveBeenCalled();
    expect(prime(db, "settlementPlays").insertOne).toHaveBeenCalled();
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
      actions: { $gte: 1 },
    });
    // A DEBIT against the bank, not a counter climbing toward an allowance.
    expect(update.$inc["seats.$.actions"]).toBe(-1);
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
    // From the catalogue, not frozen: a tempo retune must not read as a bug.
    expect(doc.basePoints).toBe(getPlay("aid")!.magnitude);
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

  describe("per-character play limit", () => {
    it("refuses a second use of the same play in one turn", async () => {
      prime(db, "settlementPlays").countDocuments.mockResolvedValue(1);
      const { commitSettlementPlay } = await import("./commitPlay");

      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });

      expect(res).toMatchObject({ ok: false, status: 409 });
      expect(prime(db, "settlementPlays").insertOne).not.toHaveBeenCalled();
    });

    it("refuses BEFORE spending anything", async () => {
      // The allowance is not a resource you can buy past. Debiting first would
      // charge a player for a play the command then refuses.
      prime(db, "settlementPlays").countDocuments.mockResolvedValue(1);
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });

      expect(prime(db, "characters").updateOne).not.toHaveBeenCalled();
    });

    it("allows the first use", async () => {
      const { commitSettlementPlay } = await import("./commitPlay");
      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });
      expect(res).toMatchObject({ ok: true });
    });

    it("counts this character, this play, this turn only", async () => {
      const plays = prime(db, "settlementPlays");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });

      // Scoped on all four, or the allowance leaks across turns, across plays,
      // or across players.
      expect(plays.countDocuments).toHaveBeenCalledWith({
        crisisId: CRISIS_ID,
        turn: 412,
        characterId,
        playId: "letter",
        actor: "personal",
      });
    });

    it("refuses regardless of which way the second use pushes", async () => {
      // The allowance is per play, not per direction. Pushing both ways in a
      // turn is self-cancelling, so a per-direction allowance would only buy a
      // way to burn twice the action points for no board effect.
      prime(db, "settlementPlays").countDocuments.mockResolvedValue(1);
      const { commitSettlementPlay } = await import("./commitPlay");

      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: -1,
      });

      expect(res).toMatchObject({ ok: false, status: 409 });
    });

    it("loses on the unique index when two clicks race the count", async () => {
      // The count and the insert are not atomic, so two fast clicks can both
      // read zero. The index is what stops the second buying a second use.
      prime(db, "settlementPlays").insertOne.mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
      );
      const { commitSettlementPlay } = await import("./commitPlay");

      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });

      expect(res).toMatchObject({ ok: false, status: 409 });
    });

    it("gives the action points back when the index refuses the race", async () => {
      // The debit already happened, and there is no effect to pay for.
      prime(db, "settlementPlays").insertOne.mockRejectedValue(
        Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
      );
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
      });

      const refund = prime(db, "characters").updateOne.mock.calls.at(-1)![1];
      expect(refund.$inc.actions).toBeGreaterThan(0);
    });

    it("does not swallow an unrelated write failure", async () => {
      // Only a duplicate key means the allowance. Anything else is a real
      // fault and must not be reported to the player as "already used".
      prime(db, "settlementPlays").insertOne.mockRejectedValue(new Error("connection lost"));
      const { commitSettlementPlay } = await import("./commitPlay");

      await expect(
        commitSettlementPlay(db as unknown as Db, {
          characterId,
          actor: "personal",
          playId: "letter",
          direction: 1,
        })
      ).rejects.toThrow("connection lost");
    });

    it("does not limit a delegation play", async () => {
      // A seat is one actor with an action budget, not a crowd. Its brake is AP.
      prime(db, "settlementPlays").countDocuments.mockResolvedValue(9);
      const { commitSettlementPlay } = await import("./commitPlay");

      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
      });

      expect(res).toMatchObject({ ok: true });
    });
  });

  describe("payment mode", () => {
    // `aid` is DD's ℳ45M / 0-capital play. Its capital price is
    // 0 + round(4.0 points x k=4) = 16, inside the seat's banked 30.

    it("commits a funded play against capital, spending no money", async () => {
      const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
      const { commitSettlementPlay } = await import("./commitPlay");

      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
        payment: "capital",
      });

      expect(res).toMatchObject({ ok: true });
      expect(vi.mocked(spendFromTreasury)).not.toHaveBeenCalled();
    });

    it("never reads the treasury in capital mode", async () => {
      const budget = prime(db, "federalBudget");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
        payment: "capital",
      });

      expect(budget.findOne).not.toHaveBeenCalled();
    });

    it("claims the capital price, not the base capital cost", async () => {
      const crises = prime(db, "settlementCrises");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
        payment: "capital",
      });

      const [filter, update] = crises.updateOne.mock.calls[0];
      expect(filter.seats.$elemMatch.capital.$gte).toBe(16);
      expect(update.$inc["seats.$.capital"]).toBe(-16);
    });

    it("still charges the treasury when no payment mode is given", async () => {
      // An older client posts no `payment`. It has to keep working AND keep
      // paying cash: silently switching it to capital would spend a budget the
      // player never agreed to spend.
      const { spendFromTreasury } = await import("@/lib/budget/treasurySpend");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
      });

      expect(vi.mocked(spendFromTreasury)).toHaveBeenCalledWith(
        expect.anything(),
        "DD",
        45_000_000
      );
    });

    it("still adds ladder heat on the capital route", async () => {
      // Payment buys the play; it does not change what the play does. If
      // capital bought a coercive move quietly, the brink would get CHEAPER the
      // poorer a country is, which is backwards.
      const plays = prime(db, "settlementPlays");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "border",
        payment: "capital",
      });

      expect(getPlay("border")!.addsHeat).toBe(true);
      expect(plays.insertOne.mock.calls[0][0].heatAdded).toBe(1);
    });

    it("records which budget paid", async () => {
      const plays = prime(db, "settlementPlays");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
        payment: "capital",
      });

      expect(plays.insertOne.mock.calls[0][0]).toMatchObject({
        payment: "capital",
        costs: expect.objectContaining({ funds: 0, capital: 16 }),
      });
    });

    it("records the funds route on an ordinary play", async () => {
      const plays = prime(db, "settlementPlays");
      const { commitSettlementPlay } = await import("./commitPlay");

      await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "aid",
      });

      expect(plays.insertOne.mock.calls[0][0]).toMatchObject({
        payment: "funds",
        costs: expect.objectContaining({ funds: 45_000_000, capital: 0 }),
      });
    });

    it("refuses capital mode on a play with no treasury cost", async () => {
      // `terms` is capital-only already. A second route would just be a worse
      // price for the same thing.
      const { commitSettlementPlay } = await import("./commitPlay");
      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "seat",
        playId: "terms",
        payment: "capital",
      });
      expect(res).toMatchObject({ ok: false, status: 400 });
    });

    it("refuses capital mode on a personal play", async () => {
      // A character has no seat capital pool, and inventing one for a route
      // nobody asked for is a resource that exists for nothing.
      const { commitSettlementPlay } = await import("./commitPlay");
      const res = await commitSettlementPlay(db as unknown as Db, {
        characterId,
        actor: "personal",
        playId: "letter",
        direction: 1,
        payment: "capital",
      });
      expect(res).toMatchObject({ ok: false, status: 400 });
    });
  });
});
