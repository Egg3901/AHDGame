import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { EventInstance, OutcomeTier } from "@/lib/db/types/events";
import { applyDeclarativeEffects } from "./applyEffects";
import type { EventHandlerOption, EventResolveContext } from "./types";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));

const CHARACTER_ID = new ObjectId();
const ELECTION_ID = new ObjectId();

function makeCharacterInstance(): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "pree.oldFriendVenture",
    scope: "character",
    scopeId: CHARACTER_ID,
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: { electionId: ELECTION_ID.toHexString() },
    offeredAtTurn: 100,
    offeredAt: new Date(),
    expiresAtRealtimeMs: Date.now() + 60_000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCountryInstance(countryId: string): EventInstance {
  return {
    _id: new ObjectId(),
    kind: "worldEvents.sportsVictory",
    scope: "country",
    scopeId: new ObjectId(),
    definitionVersion: 1,
    status: "pending",
    roll: 50,
    payload: { countryId },
    offeredAtTurn: 100,
    offeredAt: new Date(),
    expiresAtRealtimeMs: Date.now() + 60_000,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCtx(db: MockDb, instance: EventInstance, preset?: string): EventResolveContext {
  const option: EventHandlerOption = {
    id: "act",
    label: "Act",
    description: "",
    isDefault: true,
    outcomeTable: [],
  };
  const tier: OutcomeTier = { minRoll: 1, maxRoll: 100, label: "ok", effects: [] };
  return { db: db as never, currentTurn: 100, instance, option, tier, reason: "player", preset };
}

describe("applyDeclarativeEffects era currency routing (issue #2291)", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    db.collection("characters").findOne.mockResolvedValue({
      _id: CHARACTER_ID,
      countryId: "FR",
      favorability: 50,
      infamy: 0,
      politicalInfluence: 0,
    });
    db.collection("campaigns");
    db.collection("financialTxLog");
  });

  function mockLiveRate(currencyCode: string, rate: number) {
    db.collection("exchangeRates").findOne.mockImplementation(async (filter: unknown) =>
      (filter as { currencyCode?: string })?.currencyCode === currencyCode ? { rate } : null
    );
  }

  function mockCampaignRates(rows: Array<{ currencyCode: string; baseRate: number }>) {
    db.collectionMocks.exchangeRates!.find.mockReturnValue({
      toArray: async () => rows,
    });
  }

  it("2027-default euro member credits personalWealth in EUR at the live EUR rate", async () => {
    mockLiveRate("EUR", 0.92);
    mockCampaignRates([]);

    await applyDeclarativeEffects(makeCtx(db, makeCharacterInstance(), "2027-default"), [
      { type: "personalWealth", deltaAnchor: 1_000 },
    ]);

    const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(update.$inc).toEqual({ "currencyBalances.personal.EUR": 920 });
  });

  it("1991-default keeps personalWealth in FRF for the same character", async () => {
    mockLiveRate("FRF", 4.5);
    mockCampaignRates([]);

    await applyDeclarativeEffects(makeCtx(db, makeCharacterInstance(), "1991-default"), [
      { type: "personalWealth", deltaAnchor: 1_000 },
    ]);

    const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(update.$inc).toEqual({ "currencyBalances.personal.FRF": 4_500 });
  });

  it("omitted preset keeps the legacy era-blind personalWealth routing", async () => {
    mockLiveRate("FRF", 4.5);
    mockCampaignRates([]);

    await applyDeclarativeEffects(makeCtx(db, makeCharacterInstance()), [
      { type: "personalWealth", deltaAnchor: 1_000 },
    ]);

    const [, update] = db.collectionMocks.characters!.updateOne.mock.calls[0];
    expect(update.$inc).toEqual({ "currencyBalances.personal.FRF": 4_500 });
  });

  it("2027-default prices campaignFunds in EUR at the frozen campaign basis", async () => {
    mockLiveRate("EUR", 0.92);
    mockCampaignRates([{ currencyCode: "EUR", baseRate: 0.92 }]);

    await applyDeclarativeEffects(makeCtx(db, makeCharacterInstance(), "2027-default"), [
      { type: "campaignFunds", deltaLocal: 1_000 },
    ]);

    expect(db.collectionMocks.campaigns!.updateOne).toHaveBeenCalledWith(
      { characterId: CHARACTER_ID, electionId: ELECTION_ID },
      { $inc: { "currencyBalances.campaign": 920 } }
    );
  });

  it("1991-default keeps campaignFunds on the FRF frozen basis", async () => {
    mockLiveRate("FRF", 4.5);
    mockCampaignRates([{ currencyCode: "FRF", baseRate: 4.5 }]);

    await applyDeclarativeEffects(makeCtx(db, makeCharacterInstance(), "1991-default"), [
      { type: "campaignFunds", deltaLocal: 1_000 },
    ]);

    expect(db.collectionMocks.campaigns!.updateOne).toHaveBeenCalledWith(
      { characterId: CHARACTER_ID, electionId: ELECTION_ID },
      { $inc: { "currencyBalances.campaign": 4_500 } }
    );
  });

  it("2027-default labels the country treasury payout EUR; omitted preset stays FRF", async () => {
    db.collection("federalBudget").findOne.mockResolvedValue({
      countryId: "FR",
      treasuryBalance: 1_000_000,
    });

    await applyDeclarativeEffects(makeCtx(db, makeCountryInstance("FR"), "2027-default"), [
      { type: "treasuryDelta", deltaAnchor: 5_000 },
    ]);
    const eurDoc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(eurDoc.currencyCode).toBe("EUR");
    expect(eurDoc.amount).toBe(5_000);

    vi.clearAllMocks();
    db.collection("federalBudget").findOne.mockResolvedValue({
      countryId: "FR",
      treasuryBalance: 1_000_000,
    });

    await applyDeclarativeEffects(makeCtx(db, makeCountryInstance("FR")), [
      { type: "treasuryDelta", deltaAnchor: 5_000 },
    ]);
    const frfDoc = db.collectionMocks.financialTxLog!.insertOne.mock.calls[0][0];
    expect(frfDoc.currencyCode).toBe("FRF");
    expect(frfDoc.amount).toBe(5_000);
  });
});
