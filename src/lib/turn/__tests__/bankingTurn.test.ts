import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { BankCharter, BankLoan, DepositInsuranceFund } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { MIN_DEPOSIT_RATE_PERCENT, MIN_LENDING_RATE_PERCENT } from "@/lib/banking/rates";
import {
  BASE_PREMIUM_ANNUAL,
  computeInsurancePremium,
  computeReserveRatioActual,
  getInsuredCap,
  sumInsuredPlayerDeposits,
} from "@/lib/banking/insurance";
import {
  ARREARS_DEFAULT_TURNS,
  MAX_NPC_FLOW_PER_TURN_FRACTION,
  processBankingTurn,
} from "../bankingTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TURN = 100;

function makeCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    totalDeposits: 0,
    totalLoans: 0,
    npcDeposits: 0,
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
    liquidCapital: 50_000_000,
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

describe("processBankingTurn", () => {
  let db: MockDb;
  let bankId: ObjectId;
  let bankCorp: Corporation;
  let liveCorp: Corporation;
  let cbState: { externalBroadMoney: number; primeRate: number };
  let characterState: {
    _id: ObjectId;
    savings: number;
    personal: number;
    holder: string;
  };
  let loans: BankLoan[];
  let fundState: DepositInsuranceFund;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("centralBanks");
    db.collection("corporations");
    db.collection("characters");
    db.collection("bankLoans");
    db.collection("states");
    db.collection("depositInsuranceFunds");
    db.collection("interbankLoans");
    db.collection("corporateSectors");

    bankId = new ObjectId();
    bankCorp = makeBankCorp(makeCharter({ npcDeposits: 1_000_000 }), {
      _id: bankId,
      liquidCapital: 10_000_000,
    });
    liveCorp = structuredClone(bankCorp);

    cbState = { externalBroadMoney: 100_000_000, primeRate: 4 };
    characterState = {
      _id: new ObjectId(),
      savings: 48_000,
      personal: 100_000,
      holder: bankId.toString(),
    };
    loans = [];
    fundState = {
      _id: "USD",
      balance: 0,
      insuredCap: 5_000_000,
      premiumsCollectedLifetime: 0,
      payoutsLifetime: 0,
      treasuryBackstopLifetime: 0,
    };

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: TURN,
    });

    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: cbState.primeRate,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: cbState.externalBroadMoney,
          bankReserveRequirement: 0.1,
        },
      ])
    );
    db.collectionMocks.centralBanks!.findOne.mockImplementation(async () => ({
      _id: "US",
      primeRate: cbState.primeRate,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: cbState.externalBroadMoney,
      bankReserveRequirement: 0.1,
    }));

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
    db.collectionMocks.centralBanks!.updateOne.mockImplementation(async (_f, update) => {
      const inc = (update as { $inc?: { externalBroadMoney?: number } }).$inc;
      if (typeof inc?.externalBroadMoney === "number") {
        cbState.externalBroadMoney += inc.externalBroadMoney;
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    db.collectionMocks.corporations!.find.mockReturnValue(findCursor([bankCorp]));
    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (filter?._id && bankId.equals(filter._id)) {
          return structuredClone(liveCorp);
        }
        return null;
      }
    );
    db.collectionMocks.corporations!.updateOne.mockImplementation(async (filter, update) => {
      const f = filter as { _id?: ObjectId };
      if (f._id && bankId.equals(f._id)) {
        const u = update as {
          $set?: Record<string, unknown>;
          $inc?: Record<string, number>;
        };
        if (u.$set) {
          if (typeof u.$set.liquidCapital === "number") {
            liveCorp.liquidCapital = u.$set.liquidCapital as number;
          }
          if (typeof u.$set["bankCharter.npcDeposits"] === "number") {
            liveCorp.bankCharter!.npcDeposits = u.$set["bankCharter.npcDeposits"] as number;
          }
          if (typeof u.$set["bankCharter.totalDeposits"] === "number") {
            liveCorp.bankCharter!.totalDeposits = u.$set["bankCharter.totalDeposits"] as number;
          }
          if (typeof u.$set["bankCharter.totalLoans"] === "number") {
            liveCorp.bankCharter!.totalLoans = u.$set["bankCharter.totalLoans"] as number;
          }
          if (typeof u.$set["bankCharter.lastBankingTurn"] === "number") {
            liveCorp.bankCharter!.lastBankingTurn = u.$set["bankCharter.lastBankingTurn"] as number;
          }
          if (typeof u.$set["bankCharter.depositCeiling"] === "number") {
            liveCorp.bankCharter!.depositCeiling = u.$set["bankCharter.depositCeiling"] as number;
          }
        }
        if (u.$inc?.liquidCapital) {
          liveCorp.liquidCapital = (liveCorp.liquidCapital ?? 0) + u.$inc.liquidCapital;
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    const aggregateCursor = {
      toArray: vi.fn().mockResolvedValue([{ total: characterState.savings }]),
    };
    db.collectionMocks.characters!.aggregate.mockReturnValue(aggregateCursor);

    db.collectionMocks.characters!.find.mockImplementation((filter: Record<string, unknown>) => {
      const holderKey = `currencyBalances.savingsHolder.USD`;
      if (filter[holderKey] === bankId.toString()) {
        return findCursor([
          {
            _id: characterState._id,
            currencyBalances: {
              savings: { USD: characterState.savings },
              personal: { USD: characterState.personal },
              savingsHolder: { USD: characterState.holder },
            },
          },
        ]);
      }
      return findCursor([]);
    });
    db.collectionMocks.characters!.findOne.mockImplementation(
      async (filter: { _id?: ObjectId }) => {
        if (filter?._id && characterState._id.equals(filter._id)) {
          return {
            _id: characterState._id,
            currencyBalances: {
              savings: { USD: characterState.savings },
              personal: { USD: characterState.personal },
            },
          };
        }
        return null;
      }
    );
    db.collectionMocks.characters!.bulkWrite.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops as {
        updateOne: { filter: { _id: ObjectId }; update: { $inc?: Record<string, number> } };
      }[]) {
        const inc = op.updateOne.update.$inc ?? {};
        if (typeof inc["currencyBalances.savings.USD"] === "number") {
          characterState.savings += inc["currencyBalances.savings.USD"];
        }
        if (typeof inc["currencyBalances.personal.USD"] === "number") {
          characterState.personal += inc["currencyBalances.personal.USD"];
        }
      }
      return { modifiedCount: ops.length, matchedCount: ops.length };
    });
    db.collectionMocks.characters!.updateOne.mockImplementation(async (filter, update) => {
      const f = filter as { _id?: ObjectId };
      if (f._id && characterState._id.equals(f._id)) {
        const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};
        if (typeof inc["currencyBalances.personal.USD"] === "number") {
          characterState.personal += inc["currencyBalances.personal.USD"];
        }
        if (typeof inc["currencyBalances.savings.USD"] === "number") {
          characterState.savings += inc["currencyBalances.savings.USD"];
        }
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    db.collectionMocks.bankLoans!.find.mockImplementation(() => findCursor([...loans]));
    db.collectionMocks.bankLoans!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (filter.borrowerType === "npcBulk") {
          return loans.find((l) => l.borrowerType === "npcBulk" && l.status !== "repaid") ?? null;
        }
        return loans.find((l) => filter._id && l._id.equals(filter._id as ObjectId)) ?? null;
      }
    );
    db.collectionMocks.bankLoans!.insertOne.mockImplementation(async (doc: BankLoan) => {
      loans.push(doc);
      return { insertedId: doc._id };
    });
    db.collectionMocks.bankLoans!.updateOne.mockImplementation(async (filter, update) => {
      const f = filter as { _id?: ObjectId };
      const idx = loans.findIndex((l) => f._id && l._id.equals(f._id));
      if (idx >= 0) {
        const u = update as { $set?: Partial<BankLoan> };
        loans[idx] = { ...loans[idx], ...u.$set };
      }
      return { matchedCount: 1, modifiedCount: 1 };
    });

    // GDP: 1_000_000 millions → $1T face (keeps NPC book non-zero but tests can ignore)
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 1_000_000 }]));

    db.collectionMocks.interbankLoans!.find.mockReturnValue(findCursor([]));
    db.collectionMocks.interbankLoans!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    // Default: large financial capacity so ceiling does not bind existing tests
    // (250_000 units × 0.5 × 1.2M = 150B).
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      findCursor([{ capitalStock: 250_000, sectorType: "financial", revenue: 0 }])
    );
  });

  it("is a no-op when private banking is disabled", async () => {
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: false,
    });
    const summary = await processBankingTurn(db as unknown as Db, TURN);
    expect(summary).toEqual({
      banksProcessed: 0,
      depositInterestPaid: 0,
      depositInterestShortfall: 0,
      loanInterestCollected: 0,
      loanPrincipalRepaid: 0,
      defaultsWrittenOff: 0,
      npcDepositDelta: 0,
      npcBulkShortfall: 0,
      premiumShortfall: 0,
      interbankInterestPaid: 0,
      interbankDefaultsWrittenOff: 0,
      cbMarginInterestPaid: 0,
      cbMarginInterestShortfall: 0,
    });
    expect(db.collectionMocks.corporations!.find).not.toHaveBeenCalled();
  });

  it("is idempotent: second call same turn is a no-op", async () => {
    const first = await processBankingTurn(db as unknown as Db, TURN);
    expect(first.banksProcessed).toBe(1);
    expect(liveCorp.bankCharter!.lastBankingTurn).toBe(TURN);

    // Refresh the find() seed so the second pass still sees the bank,
    // but live findOne carries lastBankingTurn.
    bankCorp.bankCharter!.lastBankingTurn = TURN;
    db.collectionMocks.corporations!.find.mockReturnValue(findCursor([bankCorp]));

    const cbBefore = cbState.externalBroadMoney;
    const liqBefore = liveCorp.liquidCapital;
    const savBefore = characterState.savings;

    const second = await processBankingTurn(db as unknown as Db, TURN);
    expect(second.banksProcessed).toBe(0);
    expect(cbState.externalBroadMoney).toBe(cbBefore);
    expect(liveCorp.liquidCapital).toBe(liqBefore);
    expect(characterState.savings).toBe(savBefore);
  });

  it("conserves deposit interest: character + npc credits == liquidCapital debit (net of premium)", async () => {
    // Disable NPC flow by setting npcDeposits already at a stable target-ish
    // and give the bank enough cash. Use depositOffset so rate is known.
    liveCorp.bankCharter!.depositOffset = 0;
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    // Zero broad money → no NPC deposit flow; npc interest = 0
    cbState.externalBroadMoney = 0;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: 0,
          bankReserveRequirement: 0.1,
        },
      ])
    );
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 0,
      bankReserveRequirement: 0.1,
    });
    // No NPC bulk income either
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 0 }]));

    const liqBefore = liveCorp.liquidCapital ?? 0;
    const savBefore = characterState.savings;
    const fundBefore = fundState.balance;
    // deposit rate = max(0.05, 4+0) = 4%. Interest = 48000 * 0.04 / 48 = 40
    const expectedInterest = (savBefore * 4) / 100 / TURNS_PER_YEAR;

    const summary = await processBankingTurn(db as unknown as Db, TURN);

    const characterCredit = characterState.savings - savBefore;
    const premiumPaid = fundState.balance - fundBefore;
    const liquidDebit = liqBefore - (liveCorp.liquidCapital ?? 0);
    expect(summary.depositInterestPaid).toBeCloseTo(expectedInterest, 5);
    expect(characterCredit).toBeCloseTo(expectedInterest, 5);
    expect(liquidDebit).toBeCloseTo(expectedInterest + premiumPaid, 5);
  });

  it("conserves insurance premium: fund gain == bank liquidCapital debit", async () => {
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    cbState.externalBroadMoney = 0;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: 0,
          bankReserveRequirement: 0.1,
        },
      ])
    );
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "US",
      primeRate: 4,
      inflationHistory: [{ turn: 1, rate: 0 }],
      externalBroadMoney: 0,
      bankReserveRequirement: 0.1,
    });
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 0 }]));

    characterState.savings = 480_000;
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 480_000 }]),
    });

    const liqBefore = liveCorp.liquidCapital ?? 0;
    const fundBefore = fundState.balance;
    const savBefore = characterState.savings;

    await processBankingTurn(db as unknown as Db, TURN);

    const interestPaid = characterState.savings - savBefore;
    const premiumPaid = fundState.balance - fundBefore;
    const liquidDebit = liqBefore - (liveCorp.liquidCapital ?? 0);

    expect(premiumPaid).toBeGreaterThan(0);
    expect(fundState.premiumsCollectedLifetime).toBeCloseTo(premiumPaid, 8);
    expect(liquidDebit).toBeCloseTo(interestPaid + premiumPaid, 5);

    const cap = await getInsuredCap(db as unknown as Db, "USD");
    const insured = sumInsuredPlayerDeposits([characterState.savings], cap);
    // Premium was computed on post-interest balances; reverse-check magnitude.
    const liqAfterInterest = liqBefore - interestPaid;
    const actual = computeReserveRatioActual(liqAfterInterest, characterState.savings);
    const expectedPremium = computeInsurancePremium(insured, actual, 0.1);
    expect(premiumPaid).toBeCloseTo(expectedPremium, 5);
    expect(BASE_PREMIUM_ANNUAL).toBe(0.004);
  });

  it("conserves NPC deposit flow: delta == -externalBroadMoney delta", async () => {
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    characterState.savings = 0;
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 0 }]),
    });
    db.collectionMocks.characters!.find.mockReturnValue(findCursor([]));

    const broadBefore = 100_000_000;
    cbState.externalBroadMoney = broadBefore;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: broadBefore,
        },
      ])
    );

    const summary = await processBankingTurn(db as unknown as Db, TURN);
    const broadAfter = cbState.externalBroadMoney;
    const npcAfter = liveCorp.bankCharter!.npcDeposits ?? 0;

    // The pool funds the deposit migration AND pays NPC bulk loan interest
    // (no player loans in this scenario, so loanInterestCollected is all bulk).
    expect(broadBefore - broadAfter).toBeCloseTo(
      summary.npcDepositDelta + summary.loanInterestCollected,
      5
    );
    // npcDeposits also receives deposit interest after the flow, so final stock
    // is delta + interest, not delta alone.
    expect(npcAfter).toBeGreaterThanOrEqual(summary.npcDepositDelta);
    expect(Math.abs(summary.npcDepositDelta)).toBeLessThanOrEqual(
      MAX_NPC_FLOW_PER_TURN_FRACTION * Math.max(summary.npcDepositDelta, broadBefore) + 1e-6
    );
  });

  it("pays deposit interest pro rata when bank cash is insufficient and never goes negative", async () => {
    liveCorp.liquidCapital = 10;
    bankCorp.liquidCapital = 10;
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    cbState.externalBroadMoney = 0;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: 0,
        },
      ])
    );
    // Skip NPC bulk income by zeroing GDP
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 0 }]));

    characterState.savings = 480_000; // interest due = 480000*0.04/48 = 400
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 480_000 }]),
    });

    const savBefore = characterState.savings;
    const summary = await processBankingTurn(db as unknown as Db, TURN);

    expect(summary.depositInterestShortfall).toBeGreaterThan(0);
    expect(summary.depositInterestPaid).toBeLessThanOrEqual(10 + 1e-9);
    expect(characterState.savings - savBefore).toBeCloseTo(summary.depositInterestPaid, 5);
    expect(liveCorp.liquidCapital ?? 0).toBeGreaterThanOrEqual(0);
  });

  it("conserves loan payment: borrower debit == bank credit; outstanding drops by principal", async () => {
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    cbState.externalBroadMoney = 0;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: 0,
        },
      ])
    );
    characterState.savings = 0;
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 0 }]),
    });
    db.collectionMocks.characters!.find.mockReturnValue(findCursor([]));
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 0 }]));

    const outstanding = 4_800;
    const ratePercent = 4.8;
    const termTurns = 48;
    const loan: BankLoan = {
      _id: new ObjectId(),
      bankCorporationId: bankId,
      currency: "USD",
      borrowerType: "character",
      borrowerId: characterState._id,
      principal: outstanding,
      outstanding,
      ratePercent,
      originatedTurn: TURN,
      termTurns,
      status: "current",
    };
    loans = [loan];
    liveCorp.bankCharter!.totalLoans = outstanding;
    bankCorp.bankCharter!.totalLoans = outstanding;

    const personalBefore = characterState.personal;
    const liqBefore = liveCorp.liquidCapital ?? 0;

    const interestDue = (outstanding * (ratePercent / 100)) / TURNS_PER_YEAR;
    const principalDue = outstanding / termTurns;
    const paymentDue = interestDue + principalDue;

    const summary = await processBankingTurn(db as unknown as Db, TURN);

    expect(summary.loanInterestCollected).toBeCloseTo(interestDue, 5);
    expect(summary.loanPrincipalRepaid).toBeCloseTo(principalDue, 5);
    expect(personalBefore - characterState.personal).toBeCloseTo(paymentDue, 5);
    expect((liveCorp.liquidCapital ?? 0) - liqBefore).toBeCloseTo(paymentDue, 5);
    expect(loans[0].outstanding).toBeCloseTo(outstanding - principalDue, 5);
    expect(loans[0].lastProcessedTurn).toBe(TURN);
  });

  it("defaults after ARREARS_DEFAULT_TURNS shortfalls and writes off exactly outstanding", async () => {
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    cbState.externalBroadMoney = 0;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: 0,
        },
      ])
    );
    characterState.savings = 0;
    characterState.personal = 0; // cannot pay
    db.collectionMocks.characters!.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ total: 0 }]),
    });
    db.collectionMocks.characters!.find.mockReturnValue(findCursor([]));
    db.collectionMocks.states!.find.mockReturnValue(findCursor([{ _id: "CA", gdp: 0 }]));

    const outstanding = 10_000;
    const loan: BankLoan = {
      _id: new ObjectId(),
      bankCorporationId: bankId,
      currency: "USD",
      borrowerType: "character",
      borrowerId: characterState._id,
      principal: outstanding,
      outstanding,
      ratePercent: 5,
      originatedTurn: TURN - 10,
      termTurns: 48,
      status: "arrears",
      arrearsTurns: ARREARS_DEFAULT_TURNS - 1,
    };
    loans = [loan];
    liveCorp.bankCharter!.totalLoans = outstanding;

    const summary = await processBankingTurn(db as unknown as Db, TURN);
    expect(summary.defaultsWrittenOff).toBeCloseTo(outstanding, 5);
    expect(loans[0].status).toBe("defaulted");
    expect(liveCorp.bankCharter!.totalLoans).toBeCloseTo(0, 5);
  });

  it("floors effective rates at the banking module mins", () => {
    expect(MIN_DEPOSIT_RATE_PERCENT).toBeGreaterThan(0);
    expect(MIN_LENDING_RATE_PERCENT).toBeGreaterThan(0);
  });

  it("stops NPC deposit inflow at the capacity ceiling", async () => {
    // Ceiling = 10 units × 0.5 × 1.2M = 6_000_000. Player holds 48k.
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      findCursor([{ capitalStock: 10, sectorType: "financial", revenue: 0 }])
    );
    liveCorp.bankCharter!.npcDeposits = 0;
    bankCorp.bankCharter!.npcDeposits = 0;
    liveCorp.bankCharter!.branchCapacityShare = 0.5;
    bankCorp.bankCharter!.branchCapacityShare = 0.5;
    cbState.externalBroadMoney = 100_000_000;
    db.collectionMocks.centralBanks!.find.mockReturnValue(
      findCursor([
        {
          _id: "US",
          primeRate: 4,
          inflationHistory: [{ turn: 1, rate: 0 }],
          externalBroadMoney: cbState.externalBroadMoney,
          bankReserveRequirement: 0.1,
        },
      ])
    );

    await processBankingTurn(db as unknown as Db, TURN);
    const npc = liveCorp.bankCharter!.npcDeposits ?? 0;
    const player = characterState.savings;
    const ceiling = liveCorp.bankCharter!.depositCeiling ?? 0;
    expect(ceiling).toBe(6_000_000);
    expect(npc + player).toBeLessThanOrEqual(ceiling + 1e-6);
    expect(npc).toBeGreaterThan(0);
  });

  it("allows NPC outflow even when total deposits exceed the ceiling", async () => {
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      findCursor([{ capitalStock: 10, sectorType: "financial", revenue: 0 }])
    );
    // Ceiling 6M; start NPC well above it so flow must be outward.
    liveCorp.bankCharter!.npcDeposits = 20_000_000;
    bankCorp.bankCharter!.npcDeposits = 20_000_000;
    liveCorp.bankCharter!.branchCapacityShare = 0.5;
    bankCorp.bankCharter!.branchCapacityShare = 0.5;
    cbState.externalBroadMoney = 100_000_000;

    const before = liveCorp.bankCharter!.npcDeposits!;
    const summary = await processBankingTurn(db as unknown as Db, TURN);
    expect(summary.npcDepositDelta).toBeLessThan(0);
    expect(liveCorp.bankCharter!.npcDeposits!).toBeLessThan(before);
  });

  it("grandfathers player deposits above the ceiling: NPC target goes to zero", async () => {
    // Tiny ceiling (1 unit × 0.5 × 1.2M = 600k); player holds 48k normally —
    // bump player savings above the ceiling.
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      findCursor([{ capitalStock: 1, sectorType: "financial", revenue: 0 }])
    );
    characterState.savings = 2_000_000;
    const aggregateCursor = {
      toArray: vi.fn().mockResolvedValue([{ total: characterState.savings }]),
    };
    db.collectionMocks.characters!.aggregate.mockReturnValue(aggregateCursor);

    liveCorp.bankCharter!.npcDeposits = 500_000;
    bankCorp.bankCharter!.npcDeposits = 500_000;
    liveCorp.bankCharter!.branchCapacityShare = 0.5;
    bankCorp.bankCharter!.branchCapacityShare = 0.5;
    cbState.externalBroadMoney = 100_000_000;

    const before = liveCorp.bankCharter!.npcDeposits!;
    await processBankingTurn(db as unknown as Db, TURN);
    // NPC target is 0 -> outflow toward zero; player principal is grandfathered
    // (interest may still credit the savings balance).
    expect(liveCorp.bankCharter!.npcDeposits!).toBeLessThan(before);
    expect(characterState.savings).toBeGreaterThanOrEqual(2_000_000);
    expect(liveCorp.bankCharter!.depositCeiling).toBe(600_000);
  });
});
