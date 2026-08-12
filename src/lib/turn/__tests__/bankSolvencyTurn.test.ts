import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter, BankLoan, DepositInsuranceFund } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import {
  CONTAGION_PANIC_TURNS,
  FLIGHT_RATE_BY_BAND,
  processBankSolvencyTurn,
} from "../bankSolvencyTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TURN = 200;

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 50_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 1_000_000,
    totalLoans: 300_000,
    npcDeposits: 1_000_000,
    blacklist: {},
    ...overrides,
  };
}

function makeBankCorp(
  charter: BankCharter,
  overrides: Partial<Corporation> & { _id?: ObjectId } = {}
): Corporation {
  const { _id, ...rest } = overrides;
  return {
    _id: _id ?? new ObjectId(),
    name: "Test Bank",
    type: "financial",
    liquidCapital: 40_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    headquartersState: "CA",
    bankCharter: charter,
    ...rest,
  } as unknown as Corporation;
}

function findCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

describe("processBankSolvencyTurn", () => {
  let db: MockDb;
  let liveCorps: Map<string, Corporation>;
  let cbState: { externalBroadMoney: number };
  let loans: BankLoan[];
  let historyInserts: unknown[];
  let fundState: DepositInsuranceFund;
  let charactersByBank: Map<string, { _id: ObjectId; savings: number; holder: string }[]>;
  let treasuryBalance: number;

  function seedBanks(corps: Corporation[]) {
    // Shallow-clone charter only; structuredClone breaks BSON ObjectId.
    liveCorps = new Map(
      corps.map((c) => [
        c._id.toString(),
        { ...c, bankCharter: c.bankCharter ? { ...c.bankCharter } : undefined },
      ])
    );
    db.collectionMocks.corporations!.find.mockImplementation((filter?: Record<string, unknown>) => {
      let docs = [...liveCorps.values()];
      const status = filter?.["bankCharter.status"];
      if (status === "failed") {
        docs = docs.filter((c) => c.bankCharter?.status === "failed");
        const resolvedFilter = filter?.["bankCharter.depositorsResolvedTurn"] as
          { $exists?: boolean } | undefined;
        if (resolvedFilter?.$exists === false) {
          docs = docs.filter((c) => c.bankCharter?.depositorsResolvedTurn == null);
        }
      } else if (status === "active") {
        docs = docs.filter((c) => c.bankCharter?.status === "active");
      }
      return findCursor(
        docs.map((c) => ({
          ...c,
          bankCharter: c.bankCharter ? { ...c.bankCharter } : undefined,
        }))
      );
    });
    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (!filter?._id) return null;
        const live = liveCorps.get(filter._id.toString());
        if (!live) return null;
        return {
          ...live,
          bankCharter: live.bankCharter ? { ...live.bankCharter } : undefined,
        };
      }
    );
    // Depositor resolution CLAIMS its idempotency key atomically before it
    // touches anyone, so a crash cannot let a retry haircut twice. Without this
    // the claim returns undefined here and the whole resolution no-ops.
    db.collectionMocks.corporations!.findOneAndUpdate.mockImplementation(
      async (filter: { _id?: ObjectId }, update: { $set?: Record<string, unknown> }) => {
        if (!filter?._id) return null;
        const live = liveCorps.get(filter._id.toString());
        if (!live?.bankCharter) return null;
        if (live.bankCharter.status !== "failed") return null;
        if (live.bankCharter.depositorsResolvedTurn != null) return null;
        const before = { ...live, bankCharter: { ...live.bankCharter } };
        const stamp = update?.$set?.["bankCharter.depositorsResolvedTurn"];
        if (typeof stamp === "number") live.bankCharter.depositorsResolvedTurn = stamp;
        return before;
      }
    );
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("centralBanks");
    db.collection("corporations");
    db.collection("bankLoans");
    db.collection("bankCharterHistory");
    db.collection("characters");
    db.collection("depositInsuranceFunds");
    db.collection("federalBudget");
    db.collection("interbankLoans");
    db.collection("exchangeRates");
    db.collection("indexFunds");
    db.collection("bonds");

    liveCorps = new Map();
    cbState = { externalBroadMoney: 50_000_000 };
    loans = [];
    historyInserts = [];
    charactersByBank = new Map();
    treasuryBalance = 100_000_000;
    fundState = {
      _id: "USD",
      balance: 5_000_000,
      insuredCap: 5_000_000,
      premiumsCollectedLifetime: 0,
      payoutsLifetime: 0,
      treasuryBackstopLifetime: 0,
    };

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankContagionEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: TURN,
    });

    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.1,
    });
    db.collectionMocks.centralBanks!.updateOne.mockImplementation(async (_f, update) => {
      const inc = (update as { $inc?: { externalBroadMoney?: number } }).$inc;
      if (typeof inc?.externalBroadMoney === "number") {
        cbState.externalBroadMoney += inc.externalBroadMoney;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    db.collectionMocks.corporations!.updateOne.mockImplementation(async (filter, update) => {
      const f = filter as { _id?: ObjectId };
      if (!f._id) return { matchedCount: 0, modifiedCount: 0 };
      const live = liveCorps.get(f._id.toString());
      if (!live?.bankCharter) return { matchedCount: 0, modifiedCount: 0 };
      const u = update as {
        $set?: Record<string, unknown>;
        $inc?: Record<string, number>;
      };
      if (u.$inc) {
        for (const [key, value] of Object.entries(u.$inc)) {
          if (key === "liquidCapital") {
            live.liquidCapital = (live.liquidCapital ?? 0) + value;
          } else if (key.startsWith("bankCharter.")) {
            const field = key.slice("bankCharter.".length);
            const cur = (live.bankCharter as unknown as Record<string, number>)[field] ?? 0;
            (live.bankCharter as unknown as Record<string, number>)[field] = cur + value;
          }
        }
      }
      if (u.$set) {
        if (typeof u.$set.liquidCapital === "number") {
          live.liquidCapital = u.$set.liquidCapital as number;
        }
        for (const [key, value] of Object.entries(u.$set)) {
          if (key === "updatedAt" || key === "liquidCapital") continue;
          if (key.startsWith("bankCharter.")) {
            const field = key.slice("bankCharter.".length);
            (live.bankCharter as unknown as Record<string, unknown>)[field] = value;
          }
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    db.collectionMocks.characters!.find.mockImplementation((filter: Record<string, unknown>) => {
      const holderKey = Object.keys(filter).find((k) =>
        k.startsWith("currencyBalances.savingsHolder.")
      );
      if (!holderKey) return findCursor([]);
      const bankHex = filter[holderKey] as string;
      const chars = charactersByBank.get(bankHex) ?? [];
      return findCursor(
        chars.map((c) => ({
          _id: c._id,
          currencyBalances: {
            savings: { USD: c.savings },
            savingsHolder: { USD: c.holder },
          },
        }))
      );
    });
    db.collectionMocks.characters!.bulkWrite.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops as {
        updateOne: {
          filter: { _id: ObjectId };
          update: { $set?: Record<string, unknown>; $inc?: Record<string, number> };
        };
      }[]) {
        for (const chars of charactersByBank.values()) {
          const ch = chars.find((c) => c._id.equals(op.updateOne.filter._id));
          if (!ch) continue;
          const set = op.updateOne.update.$set ?? {};
          const inc = op.updateOne.update.$inc ?? {};
          if (typeof set["currencyBalances.savingsHolder.USD"] === "string") {
            ch.holder = set["currencyBalances.savingsHolder.USD"] as string;
          }
          if (typeof inc["currencyBalances.savings.USD"] === "number") {
            ch.savings += inc["currencyBalances.savings.USD"];
          }
        }
      }
      return { modifiedCount: ops.length, matchedCount: ops.length };
    });

    db.collectionMocks.depositInsuranceFunds!.updateOne.mockImplementation(async (_f, update) => {
      const u = update as {
        $setOnInsert?: Partial<DepositInsuranceFund>;
        $inc?: Record<string, number>;
      };
      if (u.$inc) {
        for (const [k, v] of Object.entries(u.$inc)) {
          (fundState as unknown as Record<string, number>)[k] =
            ((fundState as unknown as Record<string, number>)[k] ?? 0) + v;
        }
      }
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    });
    db.collectionMocks.depositInsuranceFunds!.findOne.mockImplementation(async () => ({
      ...fundState,
    }));

    db.collectionMocks.federalBudget!.updateOne.mockImplementation(async (_f, update) => {
      const inc = (update as { $inc?: { treasuryBalance?: number } }).$inc;
      if (typeof inc?.treasuryBalance === "number") treasuryBalance += inc.treasuryBalance;
      return { matchedCount: 1, modifiedCount: 1 };
    });

    db.collectionMocks.bankLoans!.aggregate.mockImplementation((pipeline: unknown[]) => {
      const match = (pipeline[0] as { $match?: Record<string, unknown> })?.$match ?? {};
      const status = match.status;
      const lastProcessedTurn = match.lastProcessedTurn;
      const bankId = match.bankCorporationId as ObjectId | undefined;
      let sum = 0;
      for (const loan of loans) {
        if (bankId && !loan.bankCorporationId.equals(bankId)) continue;
        if (status && loan.status !== status) continue;
        if (lastProcessedTurn !== undefined && loan.lastProcessedTurn !== lastProcessedTurn) {
          continue;
        }
        sum += loan.outstanding;
      }
      return { toArray: vi.fn().mockResolvedValue(sum > 0 ? [{ total: sum }] : []) };
    });

    db.collectionMocks.bankCharterHistory!.insertOne.mockImplementation(async (doc) => {
      historyInserts.push(doc);
      return { insertedId: (doc as { _id: ObjectId })._id };
    });

    db.collectionMocks.interbankLoans!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.interbankLoans!.find.mockReturnValue(findCursor([]));
    db.collectionMocks.interbankLoans!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.interbankLoans!.updateMany.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });
    db.collectionMocks.exchangeRates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { currencyCode: "USD", rate: 1 },
        { currencyCode: "EUR", rate: 1 },
      ]),
    });
  });

  it("is a no-op when private banking is disabled", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: false,
    });
    const corp = makeBankCorp(makeCharter());
    seedBanks([corp]);

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary).toEqual({
      banksEvaluated: 0,
      fled: 0,
      failures: 0,
      contagionTriggered: 0,
      depositorsResolved: 0,
      insurancePaid: 0,
      haircutsApplied: 0,
      forcedLiquidations: 0,
    });
    expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
  });

  it("amber band triggers 10% NPC flight with money conservation", async () => {
    // Inputs tuned to amber via computeConfidence (see confidence.test.ts).
    const npcDeposits = 1_000_000;
    const corp = makeBankCorp(
      makeCharter({
        postedCapital: 50_000,
        totalDeposits: 1_000_000,
        totalLoans: 300_000,
        npcDeposits,
        // Flight keys on the PRIOR published band (warn one turn before it bites).
        warningBand: "amber",
      }),
      { liquidCapital: 40_000 }
    );
    seedBanks([corp]);
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.1,
    });

    const externalBefore = cbState.externalBroadMoney;
    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);

    const live = liveCorps.get(corp._id.toString())!;
    const expectedOutflow = npcDeposits * FLIGHT_RATE_BY_BAND.amber;
    expect(live.bankCharter!.warningBand).toBe("amber");
    expect(summary.fled).toBe(expectedOutflow);
    expect(live.bankCharter!.npcDeposits).toBe(npcDeposits - expectedOutflow);
    expect(cbState.externalBroadMoney).toBe(externalBefore + expectedOutflow);
    expect(summary.failures).toBe(0);
  });

  it("red band with thin capital fails the bank, archives history, and resolves depositors", async () => {
    const npcDeposits = 500_000;
    const corp = makeBankCorp(
      makeCharter({
        postedCapital: 10_000,
        totalDeposits: 1_000_000,
        totalLoans: 500_000,
        npcDeposits,
        warningBand: "red",
      }),
      { liquidCapital: 10_000 }
    );
    const depositor = {
      _id: new ObjectId(),
      savings: 80_000,
      holder: corp._id.toString(),
    };
    charactersByBank.set(corp._id.toString(), [depositor]);
    seedBanks([corp]);
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.2,
    });

    const externalBefore = cbState.externalBroadMoney;
    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    const live = liveCorps.get(corp._id.toString())!;

    expect(live.bankCharter!.warningBand).toBe("red");
    expect(summary.failures).toBe(1);
    expect(live.bankCharter!.status).toBe("failed");
    expect(live.bankCharter!.failedTurn).toBe(TURN);
    expect(historyInserts).toHaveLength(1);
    expect((historyInserts[0] as { reason: string }).reason).toBe("failed");
    expect((historyInserts[0] as { charter: BankCharter }).charter.status).toBe("failed");

    // Resolution: NPC returned (after flight), holders flipped, charter stamped.
    const fledNpc = npcDeposits * FLIGHT_RATE_BY_BAND.red;
    const npcAfterFlight = npcDeposits - fledNpc;
    expect(summary.depositorsResolved).toBe(1);
    expect(live.bankCharter!.npcDeposits).toBe(0);
    expect(live.bankCharter!.depositorsResolvedTurn).toBe(TURN);
    expect(depositor.holder).toBe("centralBank");
    expect(depositor.savings).toBe(80_000);
    expect(cbState.externalBroadMoney).toBe(externalBefore + fledNpc + npcAfterFlight);
  });

  it("resolves a prior-turn failed charter that predates this code", async () => {
    const corp = makeBankCorp(
      makeCharter({
        status: "failed",
        failedTurn: TURN - 5,
        postedCapital: 0,
        totalDeposits: 40_000,
        npcDeposits: 40_000,
        lastSolvencyTurn: TURN - 5,
      }),
      { liquidCapital: 0 }
    );
    seedBanks([corp]);
    fundState.balance = 40_000;

    const externalBefore = cbState.externalBroadMoney;
    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    const live = liveCorps.get(corp._id.toString())!;

    expect(summary.banksEvaluated).toBe(0);
    expect(summary.depositorsResolved).toBe(1);
    expect(summary.insurancePaid).toBe(40_000);
    expect(live.bankCharter!.depositorsResolvedTurn).toBe(TURN);
    expect(live.bankCharter!.npcDeposits).toBe(0);
    expect(cbState.externalBroadMoney).toBe(externalBefore + 40_000);
  });

  it("contagion sets panicTurns on same-currency peers only", async () => {
    const failing = makeBankCorp(
      makeCharter({
        postedCapital: 10_000,
        totalDeposits: 1_000_000,
        totalLoans: 500_000,
        npcDeposits: 500_000,
        currency: "USD",
        warningBand: "red",
      }),
      { liquidCapital: 10_000 }
    );
    const usdPeer = makeBankCorp(
      makeCharter({
        postedCapital: 500_000,
        totalDeposits: 100_000,
        totalLoans: 10_000,
        npcDeposits: 50_000,
        currency: "USD",
        panicTurns: 1,
      }),
      { liquidCapital: 1_000_000 }
    );
    const gbpPeer = makeBankCorp(
      makeCharter({
        postedCapital: 500_000,
        totalDeposits: 100_000,
        totalLoans: 10_000,
        npcDeposits: 50_000,
        currency: "GBP",
        panicTurns: 0,
      }),
      { liquidCapital: 1_000_000, liquidCurrencyCode: "GBP", countryId: "UK" }
    );
    seedBanks([failing, usdPeer, gbpPeer]);

    db.collectionMocks.centralBanks!.findOne.mockImplementation(
      async (filter: { _id?: string }) => {
        if (filter?._id === "GB" || filter?._id === "UK") {
          return { _id: filter._id, bankReserveRequirement: 0.1 };
        }
        return { _id: "US", bankReserveRequirement: 0.2 };
      }
    );

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary.failures).toBe(1);
    expect(summary.contagionTriggered).toBeGreaterThanOrEqual(1);

    const usdLive = liveCorps.get(usdPeer._id.toString())!;
    const gbpLive = liveCorps.get(gbpPeer._id.toString())!;
    expect(usdLive.bankCharter!.panicTurns).toBe(CONTAGION_PANIC_TURNS);
    expect(gbpLive.bankCharter!.panicTurns).toBe(0);
  });

  it("respects the contagion kill switch", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankContagionEnabled: false,
    });

    const failing = makeBankCorp(
      makeCharter({
        postedCapital: 10_000,
        totalDeposits: 1_000_000,
        totalLoans: 500_000,
        npcDeposits: 500_000,
        warningBand: "red",
      }),
      { liquidCapital: 10_000 }
    );
    const peer = makeBankCorp(
      makeCharter({
        postedCapital: 500_000,
        totalDeposits: 100_000,
        totalLoans: 10_000,
        npcDeposits: 50_000,
        panicTurns: 2,
      }),
      { liquidCapital: 1_000_000 }
    );
    seedBanks([failing, peer]);
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.2,
    });

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary.failures).toBe(1);
    expect(summary.contagionTriggered).toBe(0);
    // Peer decays instead of receiving contagion.
    expect(liveCorps.get(peer._id.toString())!.bankCharter!.panicTurns).toBe(1);
  });

  it("decays panicTurns by 1 when not newly panicked", async () => {
    const corp = makeBankCorp(
      makeCharter({
        postedCapital: 500_000,
        totalDeposits: 100_000,
        totalLoans: 10_000,
        npcDeposits: 50_000,
        panicTurns: 3,
      }),
      { liquidCapital: 1_000_000 }
    );
    seedBanks([corp]);
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      bankReserveRequirement: 0.1,
    });

    await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(liveCorps.get(corp._id.toString())!.bankCharter!.panicTurns).toBe(2);
  });

  it("is idempotent on lastSolvencyTurn", async () => {
    const corp = makeBankCorp(
      makeCharter({
        postedCapital: 50_000,
        totalDeposits: 1_000_000,
        totalLoans: 300_000,
        npcDeposits: 1_000_000,
        lastSolvencyTurn: TURN,
      }),
      { liquidCapital: 40_000 }
    );
    seedBanks([corp]);

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary.banksEvaluated).toBe(0);
    expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
  });

  it("force-liquidates a leverage breach and applies the confidence penalty", async () => {
    const { resetCorpFxRateCacheForTests } = await import("@/lib/currency/corporationCapital");
    resetCorpFxRateCacheForTests();

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      bankContagionEnabled: true,
    });

    const targetId = new ObjectId();
    // L=50k + P=50k + M=1M - D=850k → equity=250k; ratio=4 → force
    const ib = makeBankCorp(
      makeCharter({
        type: "investment",
        postedCapital: 50_000,
        totalDeposits: 0,
        totalLoans: 0,
        npcDeposits: 0,
        interbankDebt: 850_000,
        propBook: [
          {
            asset: "equity",
            ref: targetId.toString(),
            units: 100_000,
            costBasis: 1_000_000,
            markValue: 1_000_000,
          },
        ],
        propBookMarkValue: 1_000_000,
      }),
      { liquidCapital: 50_000 }
    );
    seedBanks([ib]);

    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (!filter?._id) return null;
        if (filter._id.equals(targetId)) {
          return {
            _id: targetId,
            sharePrice: 10,
            liquidCurrencyCode: "USD",
            countryId: "US",
          };
        }
        const live = liveCorps.get(filter._id.toString());
        if (!live) return null;
        return {
          ...live,
          bankCharter: live.bankCharter ? { ...live.bankCharter } : undefined,
        };
      }
    );

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary.banksEvaluated).toBe(1);
    expect(summary.forcedLiquidations).toBe(1);
    const live = liveCorps.get(ib._id.toString())!;
    const equity =
      (live.liquidCapital ?? 0) +
      (live.bankCharter!.postedCapital ?? 0) +
      (live.bankCharter!.propBookMarkValue ?? 0) -
      (live.bankCharter!.interbankDebt ?? 0) -
      (live.bankCharter!.cbMarginDebt ?? 0);
    expect(live.bankCharter!.propBookMarkValue ?? 0).toBeLessThanOrEqual(3 * equity + 1e-6);
    expect(live.bankCharter!.confidence).toBeDefined();
    expect(live.bankCharter!.confidence!).toBeLessThan(1);
  });

  it("fails an insolvent investment bank on red band and writes off funding", async () => {
    const { resetCorpFxRateCacheForTests } = await import("@/lib/currency/corporationCapital");
    resetCorpFxRateCacheForTests();

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      bankPropTradingEnabled: true,
      bankContagionEnabled: true,
    });

    const lenderId = new ObjectId();
    const ib = makeBankCorp(
      makeCharter({
        type: "investment",
        postedCapital: 0,
        totalDeposits: 0,
        totalLoans: 0,
        npcDeposits: 0,
        propBook: [],
        propBookMarkValue: 0,
        interbankDebt: 50_000,
        cbMarginDebt: 20_000,
        // Heavy defaults + no capital → red confidence
        panicTurns: 4,
      }),
      { liquidCapital: 0 }
    );
    seedBanks([ib]);

    const interbankLoan = {
      _id: new ObjectId(),
      lenderCorporationId: lenderId,
      borrowerCorporationId: ib._id,
      currency: "USD" as const,
      principal: 50_000,
      outstanding: 50_000,
      ratePercent: 5,
      originatedTurn: 1,
      status: "current" as const,
    };
    db.collectionMocks.interbankLoans!.find.mockReturnValue(findCursor([interbankLoan]));
    const defaulted: unknown[] = [];
    db.collectionMocks.interbankLoans!.updateOne.mockImplementation(async (filter, update) => {
      defaulted.push({ filter, update });
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const summary = await processBankSolvencyTurn(db as unknown as Db, TURN);
    expect(summary.failures).toBe(1);
    const live = liveCorps.get(ib._id.toString())!;
    expect(live.bankCharter!.status).toBe("failed");
    expect(live.bankCharter!.interbankDebt).toBe(0);
    expect(live.bankCharter!.cbMarginDebt).toBe(0);
    expect(defaulted.length).toBeGreaterThan(0);
  });
});
