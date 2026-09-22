/**
 * Focused tests for post-run #2159 economy telemetry.
 * Uses a tiny in-memory fake Db with a Mongo-style filter matcher, so any
 * query predicate is actually applied rather than ignored.
 */
import { describe, it, expect } from "vitest";
import {
  collectEconomyTelemetry,
  emptyEconomyTelemetry,
  FRAGILE_COMMODITIES,
  RECON_TRAILING_TURNS,
  TRAILING_TURNS,
} from "./economyTelemetry";
import { US_STATES } from "@/lib/constants";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

type Doc = Record<string, unknown>;

/** Minimal Mongo-style matcher so the fake honors pushed-down query filters. */
function matchesFilter(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const value = doc[key];
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      for (const [op, operand] of Object.entries(cond as Doc)) {
        if (op === "$gte" && !(typeof value === "number" && value >= (operand as number)))
          return false;
        if (op === "$gt" && !(typeof value === "number" && value > (operand as number)))
          return false;
        if (op === "$lte" && !(typeof value === "number" && value <= (operand as number)))
          return false;
        if (op === "$lt" && !(typeof value === "number" && value < (operand as number)))
          return false;
        if (op === "$eq" && value !== operand) return false;
        if (op === "$ne" && value === operand) return false;
        if (op === "$in" && !(Array.isArray(operand) && (operand as unknown[]).includes(value)))
          return false;
        if (op === "$exists" && (value === undefined) === Boolean(operand)) return false;
      }
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function fakeDb(data: Record<string, Doc[]>) {
  return {
    collection(name: string) {
      const docs = data[name] ?? [];
      return {
        findOne: async () => docs[0] ?? null,
        find: (filter: Doc = {}) => ({
          toArray: async () => docs.filter((d) => matchesFilter(d, filter)),
        }),
      };
    },
  } as never;
}

describe("collectEconomyTelemetry on an empty world", () => {
  it("zeroes every section without throwing and keeps reference costs deterministic", async () => {
    const db = fakeDb({});
    const t = await collectEconomyTelemetry(db);
    expect(t.reconciliation.available).toBe(false);
    expect(t.reconciliation.series).toEqual([]);
    expect(t.funds.available).toBe(false);
    expect(t.funds.flags.nppFundRedemptionEnabled.available).toBe(false);
    expect(t.corpHealth.available).toBe(false);
    expect(t.coverage.available).toBe(false);
    expect(t.coverage.emptyCombinations).toEqual([]);
    expect(t.coverage.residentLocalDemandClassification.available).toBe(false);
    expect(t.coverage.entryRejectionFunnel.available).toBe(false);
    expect(t.market.available).toBe(false);
    // Era costs need no economy collections: pure-function reference snapshot.
    expect(t.eraCosts.available).toBe(true);
    expect(t.eraCosts.referenceCosts.actionPoints.campaign).toEqual([1, 2, 3, 4, 5]);
    expect(t.eraCosts.referenceCosts.actionPoints.advertise).toEqual([5, 5, 6, 7, 8]);
    expect(t.eraCosts.referenceCosts.actionPoints.donorBuild).toEqual([4, 7, 13, 20]);
    const again = await collectEconomyTelemetry(db);
    expect(again.eraCosts.referenceCosts).toEqual(t.eraCosts.referenceCosts);
  });

  it("emptyEconomyTelemetry builds a fully zeroed report", () => {
    const t = emptyEconomyTelemetry("probe");
    expect(t.reconciliation.coveredTurns).toBe(0);
    expect(t.market.bonds.examined).toBe(0);
    expect(t.funds.orphanPositions).toEqual({ count: 0, units: 0 });
  });
});

describe("#992 reconciliation telemetry", () => {
  it("keeps the trailing-16 window and groups divergence by account kind", async () => {
    const docs: Doc[] = Array.from({ length: 20 }, (_, i) => ({
      turn: i + 1,
      status: i % 2 ? "amber" : "green",
      entriesChecked: 10,
      trialBalance: { status: "green", unbalancedCount: 0 },
      stockVsFlow: {
        status: "amber",
        skipped: false,
        divergentCount: 2,
        findings: [
          { account: "corporation:c1:USD", divergence: 100 + i },
          { account: "fund:f1:USD", divergence: -(50 + i) },
        ],
      },
      moneySupply: { findings: [{ netDrift: 5 }] },
      unattributed: [{ txType: "x", emitSite: "y", anchorAmount: 1 }],
    }));
    const db = fakeDb({ ledgerReconciliations: docs });
    const t = await collectEconomyTelemetry(db);
    expect(t.reconciliation.available).toBe(true);
    expect(t.reconciliation.coveredTurns).toBe(RECON_TRAILING_TURNS);
    expect(t.reconciliation.series).toHaveLength(16);
    expect(t.reconciliation.series[0].turn).toBe(5);
    expect(t.reconciliation.latestTurn).toBe(20);
    expect(t.reconciliation.series[0].unattributedCount).toBe(1);
    expect(t.reconciliation.series[0].moneyNetDriftAbs).toBe(5);
    const kinds = Object.fromEntries(t.reconciliation.byAccountKind.map((r) => [r.kind, r]));
    expect(kinds["corporation"].findings).toBe(16);
    expect(kinds["fund"].findings).toBe(16);
    // Window covers turns 5..20: sum |100+i| for i=4..19.
    const expected = Array.from({ length: 16 }, (_, k) => 100 + (k + 4)).reduce((a, b) => a + b, 0);
    expect(kinds["corporation"].absDivergence).toBe(expected);
  });

  it("degrades to unavailable with a note when a collector throws", async () => {
    const db = {
      collection(name: string) {
        if (name === "ledgerReconciliations") throw new Error("boom");
        return { findOne: async () => null, find: () => ({ toArray: async () => [] }) };
      },
    } as never;
    const t = await collectEconomyTelemetry(db);
    expect(t.reconciliation.available).toBe(false);
    expect(t.reconciliation.note).toContain("Collector failed");
  });
});

describe("#2120 fund telemetry", () => {
  it("reports lifetime and trailing-12 legs, queue state and orphans", async () => {
    const txs: Doc[] = [
      { kind: "subscription", turn: 1, amountAnchor: 100 },
      { kind: "subscription", turn: 90, amountAnchor: 200 },
      { kind: "subscription", turn: 95, amountAnchor: 300 },
      { kind: "redemption", turn: 96, amountAnchor: 50 },
      { kind: "redemption_queued", turn: 97, amountAnchor: 60 },
      { kind: "rebalance", turn: 97, amountAnchor: 999 },
      { kind: "expense_fee", turn: 98, amountAnchor: 5 },
      { kind: "future_kind", turn: 98, amountAnchor: 7 },
    ];
    const db = fakeDb({
      gameState: [{ currentTurn: 100, nppFundRedemptionEnabled: true }],
      indexFundTransactions: txs,
      indexFundRedemptionQueue: [
        { status: "queued", units: 10, requestedAmountAnchor: 100, paidAmountAnchor: 0 },
        { status: "partial", units: 4, requestedAmountAnchor: 40, paidAmountAnchor: 10 },
        { status: "paid", units: 0, requestedAmountAnchor: 20, paidAmountAnchor: 20 },
      ],
      indexFundPositions: [
        { fundId: "f1", units: 5 },
        { fundId: "missing", units: 7 },
      ],
      indexFunds: [{ _id: "f1" }],
    });
    const t = await collectEconomyTelemetry(db);
    expect(t.funds.available).toBe(true);
    const life = Object.fromEntries(t.funds.lifetime.map((r) => [r.kind, r]));
    expect(life["subscription"]).toMatchObject({ count: 3, amountAnchor: 600 });
    expect(life["redemption"]).toMatchObject({ count: 1, amountAnchor: 50 });
    // Non-subscription/redemption kinds must be counted, never dropped.
    expect(life["rebalance"]).toMatchObject({ count: 1, amountAnchor: 999 });
    expect(life["expense_fee"]).toMatchObject({ count: 1, amountAnchor: 5 });
    expect(life["other"]).toMatchObject({ count: 1, amountAnchor: 7 });
    // Lifetime legs conserve the full anchor flow: no kind left uncounted.
    const lifeTotal = t.funds.lifetime.reduce((s, r) => s + r.amountAnchor, 0);
    expect(lifeTotal).toBe(600 + 50 + 60 + 999 + 5 + 7);
    // Trailing-12 over turns 89..100 drops the turn-1 subscription.
    const trail = Object.fromEntries(t.funds.trailing.map((r) => [r.kind, r]));
    expect(trail["subscription"]).toMatchObject({ count: 2, amountAnchor: 500 });
    expect(trail["rebalance"]).toMatchObject({ count: 1, amountAnchor: 999 });
    expect(trail["other"]).toMatchObject({ count: 1, amountAnchor: 7 });
    expect(t.funds.trailingTurns).toEqual({ from: 89, to: 100 });
    expect(TRAILING_TURNS).toBe(12);
    expect(t.funds.redemptionQueue.unresolvedCount).toBe(2);
    expect(t.funds.redemptionQueue.unresolvedUnits).toBe(14);
    expect(t.funds.redemptionQueue.unresolvedRequestedAnchor).toBe(140);
    expect(t.funds.redemptionQueue.unresolvedPaidAnchor).toBe(10);
    expect(t.funds.orphanPositions).toEqual({ count: 1, units: 7 });
    expect(t.funds.flags.nppFundRedemptionEnabled).toEqual({ requested: true, available: true });
  });
});

describe("#2122 corp-health telemetry", () => {
  it("splits sectorType x CEO class and ranks binding inputs", async () => {
    const db = fakeDb({
      corporations: [
        { _id: "c1", type: "retail", ceoType: "npp", liquidCapital: -5 },
        { _id: "c2", type: "retail", ceoType: "npp", liquidCapital: 10 },
        { _id: "c3", type: "retail", ceoType: "character", liquidCapital: 10 },
        { _id: "c4", type: "retail", ceoType: "character", liquidCapital: 10, suspended: true },
        { _id: "c5", type: "retail", ceoType: "imperial", liquidCapital: -2 },
        { _id: "c6", type: "retail", liquidCapital: 10 },
      ],
      corporateSectors: [
        {
          corporationId: "c1",
          sectorType: "retail",
          throughputFactor: 0.5,
          throughputBindingInput: "freight",
        },
        {
          corporationId: "c2",
          sectorType: "retail",
          throughputFactor: 1,
          throughputBindingInput: "freight",
        },
        {
          corporationId: "c3",
          sectorType: "retail",
          throughputFactor: 1,
          throughputBindingInput: null,
        },
      ],
    });
    const t = await collectEconomyTelemetry(db);
    expect(t.corpHealth.available).toBe(true);
    expect(t.corpHealth.corpsExamined).toBe(5);
    const npp = t.corpHealth.bySectorCeo.find((c) => c.ceoClass === "npp");
    expect(npp).toMatchObject({
      sectorType: "retail",
      corps: 2,
      cashNegative: 1,
      cashNegativeShare: 0.5,
    });
    const character = t.corpHealth.bySectorCeo.find((c) => c.ceoClass === "character");
    expect(character).toMatchObject({ corps: 1, cashNegative: 0, cashNegativeShare: 0 });
    // Imperial-run corps keep their own cell: never folded into character.
    const imperial = t.corpHealth.bySectorCeo.find((c) => c.ceoClass === "imperial");
    expect(imperial).toMatchObject({ corps: 1, cashNegative: 1, cashNegativeShare: 1 });
    // Missing ceoType is reported, not silently assigned.
    const unknown = t.corpHealth.bySectorCeo.find((c) => c.ceoClass === "unknown");
    expect(unknown).toMatchObject({ corps: 1, cashNegative: 0 });
    expect(t.corpHealth.bySectorCeo.some((c) => (c.ceoClass as string) === "player")).toBe(false);
    expect(t.corpHealth.bindingInputs).toEqual([{ input: "freight", sectors: 2 }]);
    expect(t.corpHealth.sectorsWithBindingInput).toBe(2);
    expect(t.corpHealth.sectorsThroughputBelowOne).toBe(1);
  });
});

describe("#991 coverage telemetry", () => {
  it("lists every empty US state x sector combo and fragile fills", async () => {
    const db = fakeDb({
      corporateSectors: [
        { countryId: "US", stateId: "CA", sectorType: "retail", soldFraction: 0.5 },
        { countryId: "US", stateId: "CA", sectorType: "retail", soldFraction: 1 },
        { countryId: "UK", stateId: "LND", sectorType: "retail", soldFraction: 1 },
      ],
      commodityPrices: [
        { commodity: "advertising", globalSupply: 80, globalDemand: 100 },
        { commodity: "fertilizers", globalSupply: 0, globalDemand: 0 },
      ],
      economicVitalSigns: [
        {
          turn: 100,
          marketFormation: {
            entryFunnel: {
              corporationsObserved: 20,
              entered: 4,
              rejected: 16,
              explainedOutcomeShare: 0.95,
              reasonCounts: { entered: 4, no_viable_cell: 16 },
            },
          },
        },
      ],
    });
    const t = await collectEconomyTelemetry(db);
    expect(t.coverage.available).toBe(true);
    const universe = US_STATES.length * CORPORATION_TYPES.length;
    expect(t.coverage.presentCombos).toBe(1);
    expect(t.coverage.emptyCombos).toBe(universe - 1);
    expect(t.coverage.emptyShare).toBeCloseTo((universe - 1) / universe, 10);
    expect(t.coverage.emptyCombinations).toHaveLength(universe - 1);
    expect(t.coverage.emptyCombinations).not.toContain("CA:retail");
    expect(t.coverage.emptyCombinations[0]).toBe("AK:agriculture");
    // US-only mean: the UK row (soldFraction 1) must not move it.
    expect(t.coverage.meanSoldFraction).toBeCloseTo(0.75, 10);
    expect(t.coverage.sectorsBelowFullClearing).toBe(1);
    expect(FRAGILE_COMMODITIES).toEqual(["advertising", "fertilizers", "freight", "rare_earth"]);
    const fragile = Object.fromEntries(t.coverage.fragile.map((f) => [f.commodity, f]));
    expect(fragile["advertising"].fill).toBeCloseTo(0.8, 10);
    expect(fragile["fertilizers"].fill).toBeNull();
    expect(fragile["freight"]).toMatchObject({ supply: 0, demand: 0, fill: null });
    expect(t.coverage.entryRejectionFunnel).toMatchObject({
      available: true,
      corporationsObserved: 20,
      entered: 4,
      rejected: 16,
      explainedOutcomeShare: 0.95,
      reasonCounts: { entered: 4, no_viable_cell: 16 },
    });
  });
});

describe("#968 market telemetry", () => {
  it("computes floor-bound, fill, bond and listing shares", async () => {
    const db = fakeDb({
      gameState: [{ currentTurn: 100 }],
      corporateSectors: [
        { soldFraction: 0.5, priceRealization: 0.7 },
        { soldFraction: 1, priceRealization: 1.1 },
      ],
      commodityPrices: [{ commodity: "steel", globalSupply: 150, globalDemand: 100 }],
      commodityPriceHistory: [
        { turn: 99, globalSupply: 100, globalDemand: 100 },
        { turn: 100, globalSupply: 150, globalDemand: 100 },
      ],
      bonds: [
        // Realistic denominations: totalIssued is a face-value AMOUNT
        // (100 x BOND_UNIT_FACE_VALUE), publicFloat a UNIT count. The old
        // (amount - units) / amount math read the first bond as 0.9996.
        { totalIssued: 100_000, publicFloat: 40, holders: [{ units: 60 }] },
        { totalIssued: 100_000, publicFloat: 100, holders: [] },
        // QE-supported: no holder units but central-bank holdings, so not holderless.
        {
          totalIssued: 50_000,
          publicFloat: 50,
          holders: [],
          centralBankHoldings: 5,
          qeSupportRatio: 0.1,
        },
      ],
      shareListings: [
        { status: "open", sharesListed: 100, sharesRemaining: 25 },
        { status: "filled", sharesListed: 50, sharesRemaining: 0 },
      ],
    });
    const t = await collectEconomyTelemetry(db);
    expect(t.market.available).toBe(true);
    expect(t.market.meanSoldFraction).toBeCloseTo(0.75, 10);
    expect(t.market.belowFullClearingShare).toBeCloseTo(0.5, 10);
    expect(t.market.floorBoundShare).toBeCloseTo(0.5, 10);
    expect(t.market.globalFill).toBeCloseTo(1.5, 10);
    expect(t.market.trailingMeanGlobalFill).toBeCloseTo(1.25, 10);
    expect(t.market.bonds.examined).toBe(3);
    // (0.6 + 0 + 0) / 3: 60 of 100 units, 0 of 100, 0 of 50 subscribed.
    expect(t.market.bonds.meanSubscribedShare).toBeCloseTo(0.2, 10);
    expect(t.market.bonds.holderlessCount).toBe(1);
    expect(t.market.bonds.holderlessShare).toBeCloseTo(1 / 3, 10);
    expect(t.market.listings.byStatus).toEqual([
      { status: "filled", count: 1 },
      { status: "open", count: 1 },
    ]);
    expect(t.market.listings.openTakenShare).toBeCloseTo(0.75, 10);
  });
});

describe("test fake query filters", () => {
  it("honors pushed-down equality and range filters instead of ignoring them", async () => {
    const db = fakeDb({
      indexFundTransactions: [
        { kind: "subscription", turn: 1, amountAnchor: 100 },
        { kind: "redemption", turn: 95, amountAnchor: 50 },
      ],
    }) as unknown as {
      collection(name: string): {
        find(filter?: Doc): { toArray(): Promise<Doc[]> };
      };
    };
    const ranged = await db
      .collection("indexFundTransactions")
      .find({ turn: { $gte: 90 } })
      .toArray();
    expect(ranged).toHaveLength(1);
    expect(ranged[0].kind).toBe("redemption");
    const equal = await db
      .collection("indexFundTransactions")
      .find({ kind: "subscription" })
      .toArray();
    expect(equal).toHaveLength(1);
    expect(equal[0].turn).toBe(1);
  });
});

describe("#2119 era/cost telemetry", () => {
  it("records era IDs, missing-flag proof and deterministic fund references", async () => {
    const db = fakeDb({
      gameState: [
        { currentTurn: 48, preset: "1991-default", startingYear: 1991, currentYear: 1992 },
      ],
    });
    const t = await collectEconomyTelemetry(db);
    expect(t.eraCosts.preset).toBe("1991-default");
    expect(t.eraCosts.startingYear).toBe(1991);
    expect(t.eraCosts.currentYear).toBe(1992);
    // Flag does not exist in this tree: proof records absence, not a default.
    expect(t.eraCosts.flags.campaignEraPriceLevelEnabled).toEqual({
      requested: null,
      available: false,
    });
    const funds = t.eraCosts.referenceCosts.fundsAtNationalAverageGdp;
    expect(funds.campaign).toHaveLength(5);
    for (const v of [...funds.campaign, funds.advertise, funds.donorBuildL25]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 1000).toBe(0);
      expect(v).toBeGreaterThan(0);
    }
  });
});
