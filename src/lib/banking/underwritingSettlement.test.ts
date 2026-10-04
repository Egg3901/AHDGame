import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { listUnfinishedProjections } from "./settlementJournal";
import {
  resumeFoundingUnderwritingPlans,
  settlePrimaryUnderwritingFill,
} from "./underwritingSettlement";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const BANK = new ObjectId();
const ISSUER = new ObjectId();
const INSTRUMENT = new ObjectId();
const NOW = new Date("2026-10-04T12:00:00.000Z");

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("corporations", [
    {
      _id: BANK,
      name: "Northstar Securities",
      liquidCapital: 2_000,
      bankCharter: {
        type: "investment",
        status: "active",
        currency: "USD",
        charteredTurn: 9,
        postedCapital: 1_000,
        depositOffset: 0,
        lendingOffset: 0,
      },
    },
    { _id: ISSUER, name: "Orchid Works", liquidCapital: 1_000 },
  ]);
  db.seed("equityMarketPools", [{ _id: "USD", cashLocal: 50_000, lifetime: {} }]);
  db.seed("shareIssues", [{ _id: INSTRUMENT, filled: 0 }]);
  return db;
}

function input() {
  const issuer = { _id: ISSUER, name: "Orchid Works" };
  const bank = {
    _id: BANK,
    name: "Northstar Securities",
    bankCharter: {
      type: "investment" as const,
      status: "active" as const,
      currency: "USD" as const,
      charteredTurn: 9,
      postedCapital: 1_000,
      depositOffset: 0,
      lendingOffset: 0,
    },
  };
  return {
    bank,
    issuer,
    issuerCurrencyCode: "USD" as const,
    offer: {
      bankCorporationId: BANK,
      issuerCorporationId: ISSUER,
      charteredTurn: 9,
      currencyCode: "USD" as const,
      feeRate: 0.015,
      instrumentType: "equity" as const,
      instrumentId: INSTRUMENT,
      originalQuoteTurn: 30,
    },
    instrumentId: INSTRUMENT,
    grossPlacedLocal: 20_000,
    turn: 31,
    now: NOW,
    poolCollection: "equityMarketPools" as const,
    instrumentProjection: {
      collection: "shareIssues",
      filter: { _id: INSTRUMENT, filled: 0 },
      update: { $inc: { filled: 20_000 }, $set: { lastFilledTurn: 31 } },
      note: "Publish placed shares",
    },
  };
}

function docs(db: InMemoryDb) {
  const corps = db.collection("corporations").docs as Array<Record<string, unknown>>;
  return {
    bank: corps.find((row) => (row._id as ObjectId).equals(BANK))!,
    issuer: corps.find((row) => (row._id as ObjectId).equals(ISSUER))!,
    pool: db.collection("equityMarketPools").docs[0] as Record<string, unknown>,
    instrument: db.collection("shareIssues").docs[0] as Record<string, unknown>,
  };
}

describe("settlePrimaryUnderwritingFill", () => {
  let db: InMemoryDb;
  beforeEach(() => {
    db = world();
  });

  it("balances pool debit, issuer net, and actual bank fee exactly once", async () => {
    const fill = input();
    const result = await settlePrimaryUnderwritingFill(db as unknown as Db, fill);
    expect(result.status).toBe("applied");
    const state = docs(db);
    expect(state.pool.cashLocal).toBe(30_000);
    expect(state.pool.lifetime).toMatchObject({ issuanceOut: 20_000 });
    expect(state.issuer.liquidCapital).toBe(20_700);
    expect(state.bank.liquidCapital).toBe(2_300);
    expect(state.bank.bankUnderwritingIncomeByCurrency).toEqual({ USD: 300 });
    expect(state.bank.bankUnderwritingReceipts).toMatchObject([
      { grossPlacedLocal: 20_000, feeLocal: 300, issuerNetLocal: 19_700, charteredTurn: 9 },
    ]);
    expect(state.bank.bankUnderwritingFunding).toBeUndefined();
    expect(state.instrument).toMatchObject({ filled: 20_000, lastFilledTurn: 31 });

    const replay = await settlePrimaryUnderwritingFill(db as unknown as Db, fill);
    expect(["applied", "replayed"]).toContain(replay.status);
    expect(docs(db).pool.cashLocal).toBe(30_000);
    expect(docs(db).issuer.liquidCapital).toBe(20_700);
    expect(docs(db).bank.liquidCapital).toBe(2_300);
    expect(docs(db).bank.bankUnderwritingReceipts).toHaveLength(1);
  });

  it("does not publish or credit an unfunded fill", async () => {
    db.collection("equityMarketPools").docs[0]!.cashLocal = 100;
    const result = await settlePrimaryUnderwritingFill(db as unknown as Db, input());
    expect(result.status).toBe("rejected");
    expect(result.appliedLegs).toEqual([]);
    expect(docs(db).issuer.liquidCapital).toBe(1_000);
    expect(docs(db).bank.liquidCapital).toBe(2_000);
    expect(docs(db).instrument.filled).toBe(0);
    expect(docs(db).bank.bankUnderwritingReceipts).toBeUndefined();
    expect(docs(db).bank.bankUnderwritingFunding).toBeUndefined();
  });

  it("retains the original lease and quote through a projection crash, then resumes", async () => {
    const fill = input();
    const faulty = withInjectedCrash(db, {
      collection: "shareIssues",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(settlePrimaryUnderwritingFill(faulty.db, fill)).rejects.toBeInstanceOf(
      InjectedCrash
    );
    faulty.disarm();
    expect(docs(db).pool.cashLocal).toBe(30_000);
    expect(docs(db).bank.bankUnderwritingFunding).toMatchObject({
      key: expect.any(String),
      charteredTurn: 9,
    });
    expect(await listUnfinishedProjections(db as unknown as Db)).toHaveLength(1);

    const retry = await settlePrimaryUnderwritingFill(db as unknown as Db, {
      ...fill,
      offer: { ...fill.offer, feeRate: 0.08, charteredTurn: 10 },
    });
    expect(["applied", "replayed"]).toContain(retry.status);
    expect(docs(db).issuer.liquidCapital).toBe(20_700);
    expect(docs(db).bank.liquidCapital).toBe(2_300);
    expect(docs(db).bank.bankUnderwritingIncomeByCurrency).toEqual({ USD: 300 });
    expect(docs(db).bank.bankUnderwritingFunding).toBeUndefined();
  });

  it("recovers a private founding shell only through its frozen funded projection", async () => {
    const fill = input();
    const corps = db.collection("corporations").docs as Array<Record<string, unknown>>;
    const issuer = corps.find((row) => (row._id as ObjectId).equals(ISSUER))!;
    issuer.foundingIpoUnderwritingPending = {
      offer: fill.offer,
      grossPlacedLocal: fill.grossPlacedLocal,
      turn: fill.turn,
      instrumentProjection: {
        collection: "corporations",
        filter: {
          _id: ISSUER,
          "foundingIpoUnderwritingPending.offer.instrumentId": INSTRUMENT,
        },
        pipelineUpdate: [
          {
            $set: {
              isPrivate: false,
              publicFloat: 12,
              foundingIpoUnderwritingPending: null,
            },
          },
        ],
        note: "Publish founded issuer only after funding",
      },
    };
    expect(await db.collection("corporations").findOne({ _id: BANK })).not.toBeNull();

    const recovered = await resumeFoundingUnderwritingPlans(db as unknown as Db, NOW);
    expect(recovered).toEqual({ completed: 1, pending: 0, aborted: 0 });
    expect(docs(db).issuer).toMatchObject({
      isPrivate: false,
      publicFloat: 12,
      liquidCapital: 20_700,
    });
    expect(docs(db).issuer.foundingIpoUnderwritingPending).toBeNull();
    expect(docs(db).bank.liquidCapital).toBe(2_300);
    expect(docs(db).pool.cashLocal).toBe(30_000);
  });

  it("keeps an unpaid founding shell private if the frozen charter is unavailable", async () => {
    const fill = input();
    const corps = db.collection("corporations").docs as Array<Record<string, unknown>>;
    const issuer = corps.find((row) => (row._id as ObjectId).equals(ISSUER))!;
    const bank = corps.find((row) => (row._id as ObjectId).equals(BANK))!;
    bank.bankCharter = {
      type: "investment",
      status: "active",
      currency: "USD",
      charteredTurn: 10,
      postedCapital: 1_000,
      depositOffset: 0,
      lendingOffset: 0,
    };
    issuer.isPrivate = true;
    issuer.foundingIpoUnderwritingPending = {
      offer: fill.offer,
      grossPlacedLocal: fill.grossPlacedLocal,
      turn: fill.turn,
      instrumentProjection: {
        collection: "corporations",
        filter: { _id: ISSUER },
        pipelineUpdate: [{ $set: { isPrivate: false, foundingIpoUnderwritingPending: null } }],
        note: "Publish funded founding float",
      },
    };

    const recovered = await resumeFoundingUnderwritingPlans(db as unknown as Db, NOW);
    expect(recovered).toEqual({ completed: 0, pending: 0, aborted: 1 });
    expect(docs(db).issuer).toMatchObject({ isPrivate: true, liquidCapital: 1_000 });
    expect(docs(db).issuer.foundingIpoUnderwritingPending).toBeUndefined();
    expect(docs(db).pool.cashLocal).toBe(50_000);
    expect(docs(db).bank.liquidCapital).toBe(2_000);
  });
});
