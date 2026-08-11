/**
 * Integration test for recomputeSharePricesAfterBondTurn.
 *
 * Verifies the recompute phase reads fresh corp.liquidCapital and bond
 * marketPrices, re-runs the share-price formula, and overwrites BOTH
 * corporations.sharePrice and the same-turn corporationHistory.sharePrice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Bond, Corporation, CorporationHistory } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("recomputeSharePricesAfterBondTurn", () => {
  let db: MockDb;
  const turn = 200;

  const corp: Corporation = {
    _id: new ObjectId(),
    name: "TestCorp",
    countryId: "US",
    headquartersState: "CA",
    liquidCapital: 100_000_000, // post-bondTurn liquidCapital
    liquidCurrencyCode: "USD",
    sharePrice: 100, // placeholder written by corp turn
    totalShares: 1_000_000,
    publicFloat: 0,
    shareholders: [],
    type: "manufacturing",
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoSalary: 0,
    ceoId: null,
    sequentialId: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Corporation;

  // Same-turn corporationHistory snapshot — the corp turn wrote this.
  // Note: sectorNPV/income basis carry over from corp turn unchanged.
  const histDoc: CorporationHistory = {
    _id: new ObjectId(),
    corporationId: corp._id,
    turn,
    sharePrice: 100, // placeholder
    totalShares: 1_000_000,
    marketCap: 100_000_000,
    liquidCapital: 50_000_000, // pre-bondTurn cash (now stale)
    revenue: 4_000_000,
    totalCosts: 2_500_000,
    income: 1_500_000,
    incomePreDividends: 1_500_000,
    sectorNPV: 50_000_000,
    perTurnBondCouponIncome: 100_000,
    perTurnBondDragOnNetIncome: 50_000,
    marketingStrength: 0,
    logisticsStrength: 0,
    dividendRate: 0,
    createdAt: new Date(),
  };

  // A bond Aurora HOLDS — bondTurn has bumped marketPrice from 0.5 to 1.0.
  const heldBond: Bond = {
    _id: new ObjectId(),
    issuerType: "sovereign",
    countryId: "US",
    corporationId: new ObjectId("700000000000000000000011"),
    faceValue: 1000,
    couponRate: 4,
    maturityTurns: 240,
    issuedAtTurn: 100,
    maturityTurn: 340,
    marketPrice: 1.0, // freshly updated by bondTurn
    totalIssued: 50_000_000,
    publicFloat: 0,
    holders: [{ corporationId: corp._id, units: 50_000 }],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "corporations",
      "corporateSectors",
      "stateMetrics",
      "commodityPrices",
      "centralBanks",
      "bonds",
      "federalBudget",
      "stateBudgets",
      "tariffs",
      "subsidies",
      "states",
      "exchangeRates",
      "corporationHistory",
    ]) {
      db.collection(name);
    }
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([corp]));
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([heldBond]));
    db.collectionMocks.corporationHistory.find.mockReturnValue(makeCursor([histDoc]));

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("recomputes price using fresh liquidCapital and writes to both collections", async () => {
    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    const result = await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);

    expect(result.corpsRepriced).toBe(1);
    expect(result.corpsSkipped).toBe(0);

    // Both bulkWrites must have fired with sharePrice updates.
    const corpBulk = db.collectionMocks.corporations.bulkWrite;
    const histBulk = db.collectionMocks.corporationHistory.bulkWrite;
    expect(corpBulk).toHaveBeenCalledTimes(1);
    expect(histBulk).toHaveBeenCalledTimes(1);

    const corpOps = corpBulk.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: { sharePrice: number } } };
    }>;
    expect(corpOps).toHaveLength(1);
    expect(corpOps[0].updateOne.filter._id.equals(corp._id)).toBe(true);
    const newPrice = corpOps[0].updateOne.update.$set.sharePrice;

    // Sanity: new price > 0 and rounded to 2dp
    expect(newPrice).toBeGreaterThan(0);
    expect(newPrice).toBe(Math.round(newPrice * 100) / 100);

    // History bulkWrite must include sharePrice + recomputed marketCap +
    // post-bondTurn liquidCapital (so the Cash on Hand chart matches the
    // hero-header live corp.liquidCapital reading).
    const histOps = histBulk.mock.calls[0][0] as Array<{
      updateOne: {
        filter: { corporationId: ObjectId; turn: number };
        update: { $set: { sharePrice: number; marketCap: number; liquidCapital: number } };
      };
    }>;
    expect(histOps).toHaveLength(1);
    expect(histOps[0].updateOne.filter.turn).toBe(turn);
    expect(histOps[0].updateOne.update.$set.sharePrice).toBe(newPrice);
    expect(histOps[0].updateOne.update.$set.marketCap).toBe(Math.round(newPrice * 1_000_000));
    // Critical: the persisted history liquidCapital must match the live corp
    // value (which already reflects bondTurn coupon flows), not the stale
    // pre-bondTurn snapshot the corp turn first wrote.
    expect(histOps[0].updateOne.update.$set.liquidCapital).toBe(corp.liquidCapital);
  });

  it("reprices a corp with an unrecognized countryId instead of crashing the whole phase", async () => {
    // Incident 2026-07-22: a corp kept the pre-rename "BY" Belarus code after
    // 348fcf61b renamed it to "BLR" without a data migration. getCountryConfig
    // returned undefined and `.centralBank.defaultPrimeRate` crashed here,
    // aborting recomputeSharePricesAfterBondTurn for every corporation in the
    // world, not just this one.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const staleCountryCorp = { ...corp, countryId: "BY" } as unknown as Corporation;
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([staleCountryCorp]));

    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    const result = await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);

    expect(result.corpsRepriced).toBe(1);
    expect(result.corpsSkipped).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("ignores shareEscrowBalance — a deeply negative escrow does not depress price", async () => {
    // Regression for the BilliBilli (#125) crash: a large negative market-making
    // escrow must NOT drag the share price. tangibleBook is driven by liquid +
    // sectorNPV (+ held bonds) only; escrow is no longer a valuation input.
    const escrowCorp = {
      ...corp,
      shareEscrowBalance: -500_000_000, // dwarfs liquid(100M) + sectorNPV(50M)
    } as unknown as Corporation;
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([escrowCorp]));

    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);

    const corpOps = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    const newPrice = corpOps[0].updateOne.update.$set.sharePrice;
    // With escrow removed, price tracks liquid+sectorNPV (>= 150 per share).
    // Under the old code the -500M escrow floored tangibleBook to 0 -> price ~= 0.01.
    expect(newPrice).toBeGreaterThan(100);
  });

  it("subtracts shareIssuanceProceeds from tangible book (mirrors corp-turn calc)", async () => {
    // Bug #0772: recompute must subtract issuanceProceeds just like sectorCalculations
    // does, otherwise corps that sold shares from their float get an inflated tangible
    // book in the post-bond recompute → higher share price than the corp turn computed.
    const issuanceCorp = {
      ...corp,
      liquidCapital: 200_000_000, // 100M base + 100M from selling float shares
      shareIssuanceProceeds: 100_000_000, // realized from selling own shares
    } as unknown as Corporation;
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([issuanceCorp]));

    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);

    const corpOps = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    const newPrice = corpOps[0].updateOne.update.$set.sharePrice;

    // With 200M liquid - 100M issuanceProceeds = 100M effective + 50M sectorNPV = 150M
    // tangible book / 1M shares = 150 per share (plus earnings/growth components).
    // If issuanceProceeds were NOT subtracted, tangible book would be 250M / 1M = 250.
    expect(newPrice).toBeGreaterThan(0);
    // The price should be based on 150M tangible book, not 250M.
    // With earnings power and growth premium, expect something reasonable.
    expect(newPrice).toBeLessThan(250); // proves issuanceProceeds was subtracted
  });

  it("skips corps with no same-turn history snapshot (defensive)", async () => {
    db.collectionMocks.corporationHistory.find.mockReturnValue(makeCursor([]));
    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    const result = await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);
    expect(result.corpsRepriced).toBe(0);
    expect(result.corpsSkipped).toBe(1);
    expect(db.collectionMocks.corporations.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporationHistory.bulkWrite).not.toHaveBeenCalled();
  });

  it("returns zero results when no corporations exist", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));
    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    const result = await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);
    expect(result.corpsRepriced).toBe(0);
    expect(result.corpsSkipped).toBe(0);
  });

  it("during split cooldown, uses corp.sharePrice (post-split scaled) not turn-1 history as prior", async () => {
    // Scenario: a heavily over-priced corp just did a 10:1 reverse split. The
    // consolidate route wrote corp.sharePrice = 1000 (cap-preserving 10× scale
    // from prev $100). Turn-1 history holds the PRE-split price = 100. The
    // corp's natural BSP is LOW ($10), so without the cooldown prior-swap the
    // recompute would use prior=100 with 0.15 weight (= contribution $15),
    // pulling the price toward BSP=$10 → result ≈ $13. With the prior-swap
    // recompute uses prior=1000 with 0.7 weight (= contribution $700),
    // holding the price near the scaled value → result ≈ $702.
    const splitCorp: Corporation = {
      ...corp,
      liquidCapital: 10_000_000, // tiny equity → very low natural BSP
      sharePrice: 1000, // post-split scaled (10× pre-split $100)
      lastShareStructureTurn: turn, // cooldown == 0 (just split this turn)
    } as unknown as Corporation;
    const splitHistDoc: CorporationHistory = {
      ...histDoc,
      sharePrice: 1000, // placeholder from corp turn (also scaled)
      sectorNPV: 0, // zero out NPV so BSP is dominated by liquidCapital
      perTurnBondCouponIncome: 0,
      perTurnBondDragOnNetIncome: 0,
      income: 0,
      incomePreDividends: 0,
      revenue: 0,
      totalCosts: 0,
    };
    const prevHistDoc = {
      _id: new ObjectId(),
      corporationId: corp._id,
      turn: turn - 1,
      sharePrice: 100, // pre-split price
      totalShares: 10_000_000,
      marketCap: 1_000_000_000,
      liquidCapital: 0,
      revenue: 0,
      totalCosts: 0,
      income: 0,
      marketingStrength: 0,
      logisticsStrength: 0,
      dividendRate: 0,
      createdAt: new Date(),
    };
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([splitCorp]));
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([])); // no bonds — keep equity simple
    db.collectionMocks.corporationHistory.find.mockImplementation(
      (filter: { turn?: number } | undefined) => {
        if (filter?.turn === turn - 1) return makeCursor([prevHistDoc]);
        return makeCursor([splitHistDoc]);
      }
    );

    const { recomputeSharePricesAfterBondTurn } = await import("./recomputeSharePrices");
    await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);
    const cooldownOps = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    const priceInCooldown = cooldownOps[0].updateOne.update.$set.sharePrice;

    // Same equity setup but no cooldown — the recompute would instead use
    // prevHistDoc.sharePrice = 100 as prior with normal 0.15 weight, AND apply
    // 0.6 weight to BSP=$10. Result is dominated by BSP, much lower than the
    // cooldown run that anchors to corp.sharePrice = 1000.
    vi.clearAllMocks();
    const noCooldownCorp: Corporation = {
      ...corp,
      liquidCapital: 10_000_000,
      sharePrice: 1000,
      lastShareStructureTurn: null,
    } as unknown as Corporation;
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([noCooldownCorp]));
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.corporationHistory.find.mockImplementation(
      (filter: { turn?: number } | undefined) => {
        if (filter?.turn === turn - 1) return makeCursor([prevHistDoc]);
        return makeCursor([splitHistDoc]);
      }
    );
    await recomputeSharePricesAfterBondTurn(turn, db as unknown as Db);
    const noCooldownOps = db.collectionMocks.corporations.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    const priceWithoutCooldown = noCooldownOps[0].updateOne.update.$set.sharePrice;

    // Cooldown anchors near the scaled $1000; no-cooldown converges toward BSP=$10.
    // The cooldown price must be MUCH higher.
    expect(priceInCooldown).toBeGreaterThan(priceWithoutCooldown);
    expect(priceInCooldown).toBeGreaterThan(500); // proves cooldown held the price up
    // The no-cooldown path does NOT snap to BSP=$10 in a single turn. Because it
    // skips the split-cooldown smoothing, it instead runs through the per-turn
    // rate limiter (issue #2888, rateLimitPrice), which caps a single-turn drop
    // at SHARE_PRICE_MAX_TURN_MOVE (35%) of the prior. With the turn-1 prior at
    // $100 the floor is 100 * (1 - 0.35) = $65, so this turn lands exactly there
    // and keeps converging toward BSP over subsequent turns. The point of the
    // test still holds: the cooldown price (~$700, anchored to the scaled $1000)
    // is far above the rate-limited no-cooldown price. (Previously asserted < 50,
    // which predated the rate limiter and never accounted for its 35% floor.)
    expect(priceWithoutCooldown).toBeCloseTo(65, 5); // rate-limited 35% drop from $100 prior
  });
});
