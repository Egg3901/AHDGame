/** Funded sovereign issues conserve cash, ownership and debt across retries. */
import { commitSovereignPrimary } from "./sovereignPrimarySettlement";
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { resumeSettlement } from "@/lib/banking/settlementJournal";
import {
  issueAdminSovereignBondSeries,
  issueScheduledSovereignBondSeries,
  reconcileSovereignDebt,
} from "./sovereign";
import {
  placeUnsoldBondUnits,
  settlePlacementProceeds,
  monetizeUnsoldSovereignUnits,
} from "./primaryMarket";

vi.mock("@/lib/bonds/marketPool", async (original) => ({
  ...(await original<typeof import("@/lib/bonds/marketPool")>()),
  loadBondQuote: vi.fn().mockResolvedValue({ askPerUnit: 1020 }),
}));

const TURN = 240;
const NOW = new Date("2026-09-30T00:00:00Z");
function world(poolCash = 1_000_000): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: TURN }]);
  db.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      revenue: { total: 600_000 },
      spending: { total: 1_000_000, debtInterest: 0, byCategory: {}, stateGrants: 0 },
      debt: { principal: 0, interestRate: 0.05, ceiling: 100_000_000 },
      treasuryBalance: 100,
      surplus: -400_000,
      gdp: 1_000_000,
      creditRating: "AAA",
    },
  ]);
  db.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 5,
      externalBroadMoney: 500_000,
      netMoneyCreatedLifetime: 0,
    },
  ]);
  db.seed("bondMarketPools", [{ _id: "USD", cashLocal: poolCash, targetCashLocal: 0 }]);
  return db;
}
function budget(db: InMemoryDb) {
  return db.collection("federalBudget").docs[0];
}
function pool(db: InMemoryDb) {
  return db.collection("bondMarketPools").docs[0];
}
function cash(db: InMemoryDb) {
  return Number(budget(db).treasuryBalance) + Number(pool(db)?.cashLocal ?? 0);
}
function principal(db: InMemoryDb) {
  return (budget(db).debt as { principal: number }).principal;
}
function face(db: InMemoryDb) {
  return db.collection("bonds").docs.reduce((n, b) => n + Number(b.totalIssued), 0);
}
function assertLedger(db: InMemoryDb) {
  for (const row of db.collection("ledgerEntries").docs) {
    const legs = row.legs as { anchorAmount: number }[];
    expect(legs.reduce((n, l) => n + l.anchorAmount, 0)).toBeCloseTo(0);
  }
}

describe("sovereign primary settlement", () => {
  it("credits funded Treasury cash only from pool cash in the durable issue receipt", async () => {
    const db = world();
    const beforePool = Number(pool(db).cashLocal);
    await commitSovereignPrimary(
      db as unknown as Db,
      {
        key: "funded-cash-ledger-test",
        turn: TURN,
        countryId: "US",
        currency: "USD",
        budgetId: "federal",
        poolCash: 12_000,
        monetaryCash: 0,
        face: 12_000,
        annualCoupon: 600,
        now: NOW,
      },
      [],
      {
        ledgerShadow: true,
        treasuryCashLedgerEnabled: true,
        turnLengthMinutes: 60,
        rates: new Map([["USD", 1]]),
        ledgerTurn: TURN,
      }
    );

    expect(Number(pool(db).cashLocal)).toBe(beforePool - 12_000);
    expect(budget(db).treasuryBalance).toBe(12_100);
    expect(budget(db).treasuryCashLocal).toBe(12_000);
    expect(principal(db)).toBe(12_000);
    const cashEntry = db
      .collection("ledgerEntries")
      .docs.find((entry) =>
        (entry.legs as { account: string }[]).some((leg) =>
          leg.account.startsWith("government_cash:")
        )
      );
    expect(cashEntry?.legs).toEqual([
      expect.objectContaining({ account: "government_cash:US:USD", amount: 12_000 }),
      expect.objectContaining({ account: "bond_pool:USD:USD", amount: -12_000 }),
    ]);

    await commitSovereignPrimary(
      db as unknown as Db,
      {
        key: "funded-cash-ledger-test",
        turn: TURN,
        countryId: "US",
        currency: "USD",
        budgetId: "federal",
        poolCash: 12_000,
        monetaryCash: 0,
        face: 12_000,
        annualCoupon: 600,
        now: NOW,
      },
      [],
      {
        ledgerShadow: true,
        treasuryCashLedgerEnabled: true,
        turnLengthMinutes: 60,
        rates: new Map([["USD", 1]]),
        ledgerTurn: TURN,
      }
    );
    expect(budget(db).treasuryCashLocal).toBe(12_000);
    expect(Number(pool(db).cashLocal)).toBe(beforePool - 12_000);
  });

  it("conserves funded scheduled cash and retries without another unit or debt", async () => {
    const db = world();
    const before = cash(db);
    expect(await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW)).toBe(3);
    expect(cash(db)).toBe(before);
    expect(budget(db).treasuryBalance).toBe(100_100);
    expect(principal(db)).toBe(100_000);
    expect(face(db)).toBe(100_000);
    expect(await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW)).toBe(0);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(100_000);
    expect(db.collection("ledgerEntries").docs).toHaveLength(1);
    assertLedger(db);
  });

  it("concurrent identical admin requests cannot issue or collect twice", async () => {
    const db = world();
    const before = cash(db);
    const input = {
      countryId: "US" as const,
      turn: TURN,
      now: NOW,
      faceValue: 25_000,
      useQuarterDeficit: false,
    };
    const attempts = await Promise.allSettled([
      issueAdminSovereignBondSeries(db as unknown as Db, input),
      issueAdminSovereignBondSeries(db as unknown as Db, input),
    ]);
    expect(attempts.some((result) => result.status === "fulfilled")).toBe(true);
    await issueAdminSovereignBondSeries(db as unknown as Db, input);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(25_000);
    expect(face(db)).toBe(25_000);
    expect(db.collection("bonds").docs).toHaveLength(1);
  });

  it("rollover financing preserves the old holders until ordinary maturity", async () => {
    const db = world();
    const holder = new ObjectId();
    await db.collection("federalBudget").updateOne(
      { _id: "federal" },
      {
        $set: {
          "spending.total": 600_000,
          surplus: 0,
          "debt.principal": 100_000,
        },
      }
    );
    const id = new ObjectId();
    db.seed("bonds", [
      {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        totalIssued: 100_000,
        publicFloat: 60,
        holders: [{ holderType: "character", holderId: holder, units: 40 }],
        matured: false,
        defaulted: false,
        issuedAtTurn: 192,
        maturityTurn: 245,
        couponRate: 5,
      },
    ]);
    const before = cash(db);
    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(200_000);
    expect(face(db)).toBe(200_000);
    expect((await db.collection("bonds").findOne({ _id: id }))?.holders).toEqual([
      { holderType: "character", holderId: holder, units: 40 },
    ]);
  });

  it("funds admin issuance once and preserves both cash sides", async () => {
    const db = world();
    const before = cash(db);
    const input = {
      countryId: "US" as const,
      turn: TURN,
      now: NOW,
      faceValue: 25_000,
      useQuarterDeficit: false,
    };
    const first = await issueAdminSovereignBondSeries(db as unknown as Db, input);
    const second = await issueAdminSovereignBondSeries(db as unknown as Db, input);
    expect(second?.bondId).toEqual(first?.bondId);
    expect(first?.issueAmount).toBe(25_000);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(25_000);
    expect(budget(db).treasuryBalance).toBe(25_100);
    expect(face(db)).toBe(25_000);
    assertLedger(db);
  });

  it.each([0, 10_000])("books only paid face with %i of pool cash", async (poolCash) => {
    const db = world(poolCash);
    const before = cash(db);
    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(face(db));
    expect(principal(db)).toBeLessThanOrEqual(poolCash);
    expect(Number(budget(db).treasuryBalance) - 100).toBe(principal(db));
    expect(db.collection("bonds").docs.reduce((n, b) => n + Number(b.unsoldUnits), 0)).toBe(
      100 - face(db) / 1000
    );
  });

  it("does not invent a funded pool when the currency has none", async () => {
    const db = world();
    await db.collection("bondMarketPools").deleteMany({});
    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW);
    expect(face(db)).toBe(0);
    expect(principal(db)).toBe(0);
    expect(budget(db).treasuryBalance).toBe(100);
  });

  it("mints autonomous financing into the treasury only", async () => {
    const db = world(0);
    await db.collection("centralBanks").updateOne({ _id: "US" }, { $set: { chairMode: "npp" } });
    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW);
    expect(principal(db)).toBe(20_000);
    expect(face(db)).toBe(20_000);
    expect(budget(db).treasuryBalance).toBe(20_100);
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(500_000);
    expect(db.collection("centralBanks").docs[0].netMoneyCreatedLifetime).toBe(20_000);
    expect(db.collection("bonds").docs.reduce((n, b) => n + Number(b.centralBankHoldings), 0)).toBe(
      20
    );
    assertLedger(db);
  });

  describe("funded Treasury cash with an autonomous chair (#3401)", () => {
    function fundedWorld(poolCash: number) {
      const db = world(poolCash);
      db.collection("gameConfig").docs[0].treasuryCashLedgerEnabled = true;
      db.collection("centralBanks").docs[0].chairMode = "npp";
      return db;
    }
    function units(db: InMemoryDb, field: string) {
      return db.collection("bonds").docs.reduce((n, b) => n + Number(b[field] ?? 0), 0);
    }

    it.each([0, 10_000])(
      "quarterly issuance with %i of pool cash leaves the gap unsold instead of minting",
      async (poolCash) => {
        const db = fundedWorld(poolCash);
        const before = cash(db);
        expect(await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW)).toBe(3);
        expect(cash(db)).toBe(before);
        const paid = face(db);
        expect(paid).toBeLessThanOrEqual(poolCash);
        expect(principal(db)).toBe(paid);
        expect(budget(db).treasuryCashLocal ?? 0).toBe(paid);
        expect(budget(db).treasuryBalance).toBe(100 + paid);
        expect(units(db, "centralBankHoldings")).toBe(0);
        expect(units(db, "unsoldUnits")).toBe(100 - paid / 1000);
        const bank = db.collection("centralBanks").docs[0];
        expect(bank.netMoneyCreatedLifetime).toBe(0);
        expect(bank.monetaryOperations ?? []).toEqual([]);
        assertLedger(db);

        // Replay of the same quarter adds nothing.
        expect(await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW)).toBe(0);
        expect(cash(db)).toBe(before);
        expect(principal(db)).toBe(paid);
        expect(units(db, "unsoldUnits")).toBe(100 - paid / 1000);
      }
    );

    it("rollover issuance keeps existing principal and holder claims", async () => {
      const db = fundedWorld(0);
      const holder = new ObjectId();
      await db
        .collection("federalBudget")
        .updateOne(
          { _id: "federal" },
          { $set: { "spending.total": 600_000, surplus: 0, "debt.principal": 100_000 } }
        );
      const id = new ObjectId();
      const existing = {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        totalIssued: 100_000,
        publicFloat: 60,
        holders: [{ holderType: "character", holderId: holder, units: 40 }],
        matured: false,
        defaulted: false,
        issuedAtTurn: 192,
        maturityTurn: 245,
        couponRate: 5,
      };
      db.seed("bonds", [existing]);
      await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW);
      expect(principal(db)).toBe(100_000);
      expect(face(db)).toBe(100_000);
      expect(await db.collection("bonds").findOne({ _id: id })).toEqual(existing);
      expect(units(db, "unsoldUnits")).toBe(100);
      expect(db.collection("centralBanks").docs[0].netMoneyCreatedLifetime).toBe(0);
    });

    it("admin issuance stays pool funded", async () => {
      const db = fundedWorld(5_000);
      const result = await issueAdminSovereignBondSeries(db as unknown as Db, {
        countryId: "US",
        turn: TURN,
        now: NOW,
        faceValue: 25_000,
        useQuarterDeficit: false,
      });
      const paid = face(db);
      expect(paid).toBeGreaterThan(0);
      expect(paid).toBeLessThanOrEqual(5_000);
      expect(result?.issueAmount).toBe(paid);
      expect(principal(db)).toBe(paid);
      expect(units(db, "unsoldUnits")).toBe(25 - paid / 1000);
      expect(units(db, "centralBankHoldings")).toBe(0);
      expect(db.collection("centralBanks").docs[0].netMoneyCreatedLifetime).toBe(0);
    });

    it("reconcile securitization stays cash neutral and mints nothing", async () => {
      const db = fundedWorld(0);
      await db
        .collection("federalBudget")
        .updateOne({ _id: "federal" }, { $set: { "debt.principal": 100_000 } });
      const before = cash(db);
      await reconcileSovereignDebt(db as unknown as Db, { countryId: "US", turn: TURN, now: NOW });
      expect(cash(db)).toBe(before);
      expect(principal(db)).toBe(100_000);
      expect(units(db, "centralBankHoldings")).toBe(0);
      expect(db.collection("centralBanks").docs[0].netMoneyCreatedLifetime).toBe(0);
      expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
    });

    it("direct unsold monetization declines without touching cash, debt or units", async () => {
      const db = fundedWorld(0);
      const id = new ObjectId();
      db.seed("bonds", [
        {
          _id: id,
          issuerType: "sovereign",
          countryId: "US",
          currencyCode: "USD",
          totalIssued: 0,
          unsoldUnits: 10,
          centralBankHoldings: 0,
          couponRate: 5,
        },
      ]);
      const before = cash(db);
      expect(
        await monetizeUnsoldSovereignUnits(db as unknown as Db, {
          bondId: id,
          bank: { _id: "US" as const },
          units: 2,
          considerationLocal: 2000,
          turn: TURN,
          now: NOW,
        })
      ).toBe(false);
      expect(cash(db)).toBe(before);
      expect(principal(db)).toBe(0);
      expect(units(db, "unsoldUnits")).toBe(10);
      expect(units(db, "centralBankHoldings")).toBe(0);
      expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
    });

    it("keeps the low-level funded-money guard", async () => {
      const db = fundedWorld(0);
      await expect(
        commitSovereignPrimary(
          db as unknown as Db,
          {
            key: "funded-guard",
            turn: TURN,
            countryId: "US",
            currency: "USD",
            budgetId: "federal",
            centralBankId: "US",
            poolCash: 0,
            monetaryCash: 1000,
            face: 1000,
            annualCoupon: 50,
            now: NOW,
          },
          [],
          {
            ledgerShadow: true,
            treasuryCashLedgerEnabled: true,
            turnLengthMinutes: 60,
            rates: new Map([["USD", 1]]),
          }
        )
      ).rejects.toThrow("Funded Treasury cash cannot use monetary financing");
    });
  });

  it("later unsold placement credits ask proceeds but books face only", async () => {
    const db = world(100_000);
    const before = cash(db);
    const id = new ObjectId();
    db.seed("bonds", [
      {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        totalIssued: 0,
        publicFloat: 0,
        unsoldUnits: 500,
        requestedUnits: 500,
        couponRate: 5,
        marketPrice: 1,
        matured: false,
        defaulted: false,
        issuedAtTurn: TURN - 1,
      },
    ]);
    const placed = await placeUnsoldBondUnits(db as unknown as Db, TURN, NOW);
    await settlePlacementProceeds(db as unknown as Db, placed, new Map([["USD", 1]]), NOW);
    expect(placed.unitsPlaced).toBe(9);
    expect(cash(db)).toBe(before);
    expect(budget(db).treasuryBalance).toBe(9280);
    expect(principal(db)).toBe(9000);
    expect(budget(db).debtToGdpRatio).toBe(0.009);
    expect(face(db)).toBe(9000);
    expect((await placeUnsoldBondUnits(db as unknown as Db, TURN, NOW)).unitsPlaced).toBe(0);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(9000);
  });

  it("checks settlement status only for placements already recorded, and still refuses a pending one", async () => {
    const db = world(1_000_000);
    const ids = [new ObjectId(), new ObjectId()];
    db.seed(
      "bonds",
      ids.map((_id, index) => ({
        _id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        totalIssued: 0,
        publicFloat: 0,
        unsoldUnits: 500,
        requestedUnits: 500,
        couponRate: 5,
        marketPrice: 1,
        matured: false,
        defaulted: false,
        issuedAtTurn: TURN - 2 + index,
      }))
    );
    const journal = db.collection("bankMoneyMoves");
    const findOne = journal.findOne.bind(journal);
    const statusChecks: unknown[] = [];
    journal.findOne = (async (filter: Record<string, unknown>, options?: unknown) => {
      const projection = (options as { projection?: Record<string, unknown> } | undefined)
        ?.projection;
      if (projection && "projectionsCompletedAt" in projection) statusChecks.push(filter._id);
      return findOne(filter);
    }) as typeof journal.findOne;

    const first = await placeUnsoldBondUnits(db as unknown as Db, TURN, NOW);
    expect(first.bondsTouched).toBe(2);
    expect(statusChecks).toEqual([]);

    // A retried turn: both keys are recorded, so each takes the status check.
    expect((await placeUnsoldBondUnits(db as unknown as Db, TURN, NOW)).unitsPlaced).toBe(0);
    expect(statusChecks).toHaveLength(2);

    // A recorded placement awaiting recovery still stops the pass.
    await journal.updateOne(
      { _id: `sovereign-primary:placement:${ids[0]}:${TURN + 1}` },
      { $set: { status: "pending" } },
      { upsert: true }
    );
    await expect(placeUnsoldBondUnits(db as unknown as Db, TURN + 1, NOW)).rejects.toThrow(
      /awaits settlement recovery/
    );
  });

  it.each([
    { collection: "bondMarketPools", op: "updateOne" as const, onCall: 1, afterWrite: true },
    { collection: "federalBudget", op: "updateOne" as const, onCall: 1, afterWrite: true },
    { collection: "federalBudget", op: "updateOne" as const, onCall: 2, afterWrite: true },
    { collection: "bonds", op: "insertOne" as const, onCall: 1, afterWrite: true },
  ])("recovers exactly once after $collection $op #$onCall", async (fault) => {
    const db = world();
    const before = cash(db);
    const broken = withInjectedCrash(db, fault);
    await expect(issueScheduledSovereignBondSeries(broken.db, TURN, NOW)).rejects.toThrow();
    broken.disarm();
    expect(
      (await resumeSettlement(db as unknown as Db, "sovereign-primary:scheduled:US:240")).status
    ).toBe("applied");
    expect(await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, NOW)).toBe(0);
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(100_000);
    expect(face(db)).toBe(100_000);
    expect(budget(db).treasuryBalance).toBe(100_100);
    assertLedger(db);
  });

  it("historical debt securitization stays cash neutral", async () => {
    const db = world();
    await db
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { "debt.principal": 100_000 } });
    const before = cash(db);
    await reconcileSovereignDebt(db as unknown as Db, { countryId: "US", turn: TURN, now: NOW });
    expect(cash(db)).toBe(before);
    expect(principal(db)).toBe(100_000);
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
  });

  it("standalone monetization owns cash, debt and units under one key", async () => {
    const db = world(0);
    const id = new ObjectId();
    db.seed("bonds", [
      {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        totalIssued: 0,
        unsoldUnits: 10,
        centralBankHoldings: 0,
        couponRate: 5,
      },
    ]);
    const args = {
      bondId: id,
      bank: { _id: "US" as const },
      units: 2,
      considerationLocal: 2000,
      turn: TURN,
      now: NOW,
    };
    expect(await monetizeUnsoldSovereignUnits(db as unknown as Db, args)).toBe(true);
    expect(await monetizeUnsoldSovereignUnits(db as unknown as Db, args)).toBe(true);
    expect(budget(db).treasuryBalance).toBe(2100);
    expect(principal(db)).toBe(2000);
    expect(budget(db).debtToGdpRatio).toBe(0.002);
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(500000);
  });
  it.each(["USD", "GBP", "DEM"])(
    "rejects missing or invalid %s FX before cash or journal mutation",
    async (currency) => {
      for (const rate of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const db = world();
        const before = cash(db);
        await expect(
          commitSovereignPrimary(
            db as unknown as Db,
            {
              key: `fx:${currency}`,
              turn: TURN,
              currency,
              countryId: "US",
              budgetId: "federal",
              poolCash: 1000,
              monetaryCash: 0,
              face: 1000,
              annualCoupon: 50,
              now: NOW,
            },
            [],
            {
              ledgerShadow: true,
              turnLengthMinutes: 30,
              rates: rate === undefined ? new Map() : new Map([[currency, rate]]),
            }
          )
        ).rejects.toThrow("exchange rate");
        expect(cash(db)).toBe(before);
        expect(principal(db)).toBe(0);
        expect(db.collection("bankMoneyMoves").docs).toHaveLength(0);
        expect(db.collection("financialTxLog").docs).toHaveLength(0);
        expect(db.collection("ledgerEntries").docs).toHaveLength(0);
      }
    }
  );

  it("uses the live floating USD rate for both cash witnesses", async () => {
    const db = world();
    await db.collection("exchangeRates").updateOne({ _id: "USD" }, { $set: { rate: 1.25 } });
    await issueAdminSovereignBondSeries(db as unknown as Db, {
      countryId: "US",
      turn: TURN,
      now: NOW,
      faceValue: 10000,
      useQuarterDeficit: false,
    });
    const legs = db.collection("ledgerEntries").docs[0].legs as { anchorAmount: number }[];
    expect(legs.map((l) => l.anchorAmount)).toEqual([8000, -8000]);
  });
});
