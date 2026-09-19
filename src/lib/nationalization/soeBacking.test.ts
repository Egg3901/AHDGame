import { describe, it, expect } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CorpSnapshot } from "@/lib/turn/corporation/types";
import {
  processSoeOperations,
  estimateSoeOperatingLossAnchor,
  foldSoeCashDeltas,
  buildSoeBackingAuditEntry,
  type SoeCorpBacking,
} from "./soeOperations";
import { snapshotMarketCap } from "@/lib/turn/corporation/marketCapSnapshot";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

/**
 * #2043 — SOE treasury backing on the realized-loss contract.
 *
 * The treasury covers this turn's REALIZED operating loss (the corporation
 * turn's own snapshot income), never the upkeep-blind margin estimate and
 * never outstanding construction spend. CIP only names the residual.
 */

const NOW = new Date("2026-09-17T00:00:00Z");

function makeCorp(id: ObjectId, overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: id,
    name: "Soviet Construction Enterprise",
    countryId: "RU",
    countryOwnerId: "RU",
    type: "construction",
    liquidCapital: 0,
    createdAt: new Date(),
    ...overrides,
  } as unknown as Corporation;
}

function makeSector(
  corporationId: ObjectId,
  overrides: Partial<CorporateSector> = {}
): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId,
    stateId: "RU-MOW",
    countryId: "RU",
    sectorType: "construction",
    revenue: 1_000_000,
    realizedRevenue: 1_000_000,
    profitMargin: 12,
    createdAt: new Date(),
    ...overrides,
  } as unknown as CorporateSector;
}

type Written = {
  budgetIncs: Array<{ filter: unknown; update: Record<string, unknown> }>;
  corpBulk: unknown[];
};

function treasuryDelta(update: Record<string, unknown>): number | undefined {
  return (update as { $inc?: { treasuryBalance?: number } }).$inc?.treasuryBalance;
}

function corpLiquidInc(op: unknown): number | undefined {
  return (op as { updateOne?: { update?: { $inc?: { liquidCapital?: number } } } }).updateOne
    ?.update?.$inc?.liquidCapital;
}

function makeDb(
  corps: Corporation[],
  sectors: CorporateSector[],
  opts: { marketMode?: string; treasuryFail?: boolean } = {}
): { db: Db; written: Written } {
  const written: Written = { budgetIncs: [], corpBulk: [] };
  const db = {
    collection: (name: string) => {
      switch (name) {
        case "gameConfig":
          return { findOne: async () => ({ marketSystemMode: opts.marketMode ?? "plants" }) };
        case "corporations":
          return {
            find: () => ({ toArray: async () => corps }),
            bulkWrite: async (ops: unknown[]) => {
              written.corpBulk.push(...ops);
              return {};
            },
            updateOne: async () => ({ matchedCount: 1 }),
          };
        case "corporateSectors":
          return {
            find: () => ({ toArray: async () => sectors }),
            bulkWrite: async () => ({}),
          };
        case "exchangeRates":
          return { find: () => ({ toArray: async () => [] }) };
        case "federalBudget":
          return {
            updateOne: async (filter: unknown, update: Record<string, unknown>) => {
              if (opts.treasuryFail) throw new Error("treasury store down");
              written.budgetIncs.push({ filter, update });
              return { matchedCount: 1 };
            },
            findOne: async () => ({ treasuryBalance: 100 }),
          };
        case "macroMetrics":
        case "politicalMetrics":
        case "states":
        case "regionDemographics":
          return {
            find: () => ({ toArray: async () => [] }),
            findOne: async () => null,
            bulkWrite: async () => ({}),
            updateOne: async () => ({ matchedCount: 0 }),
          };
        default:
          return {
            find: () => ({ toArray: async () => [] }),
            findOne: async () => null,
            bulkWrite: async () => ({}),
            updateOne: async () => ({ matchedCount: 0 }),
          };
      }
    },
  } as unknown as Db;
  return { db, written };
}

describe("processSoeOperations — realized-loss backing", () => {
  it("backs an ordinary realized operating loss in full, with equal treasury/corp legs", async () => {
    const corpId = new ObjectId();
    const { db, written } = makeDb(
      [makeCorp(corpId, { liquidCapital: -500_000 })],
      [makeSector(corpId)]
    );

    const result = await processSoeOperations(
      db,
      NOW,
      1953,
      new Map([[corpId.toString(), -500_000]])
    );

    expect(result.soeCorps).toBe(1);
    expect(result.backing).toHaveLength(1);
    const [b] = result.backing;
    expect(b.shortfallAnchor).toBe(500_000);
    expect(b.realizedLossAnchor).toBe(500_000);
    expect(b.realizedSource).toBe("snapshot");
    expect(b.coveredAnchor).toBe(500_000);
    expect(b.cipHeldAnchor).toBe(0);
    expect(b.residualAnchor).toBe(0);

    // Equal legs: the treasury debit and the corp credit are the same amount.
    const debit = written.budgetIncs.find((w) => treasuryDelta(w.update) !== undefined);
    expect(debit).toBeDefined();
    expect(treasuryDelta(debit!.update)).toBe(-500_000);
    expect(written.corpBulk).toHaveLength(1);
    expect(corpLiquidInc(written.corpBulk[0])).toBe(500_000);
  });

  it("leaves an exact capex residual: residual equals held CIP, CIP never covered", async () => {
    const corpId = new ObjectId();
    // 700k hole = 500k of realized operating loss + 200k of outstanding builds.
    const { db, written } = makeDb(
      [makeCorp(corpId, { liquidCapital: -700_000 })],
      [makeSector(corpId, { constructionInProgressAnchor: 200_000 })]
    );

    const result = await processSoeOperations(
      db,
      NOW,
      1953,
      new Map([[corpId.toString(), -500_000]])
    );

    const [b] = result.backing;
    expect(b.coveredAnchor).toBe(500_000);
    expect(b.cipHeldAnchor).toBe(200_000);
    // The residual IS the held construction spend, to the unit.
    expect(b.residualAnchor).toBe(200_000);
    expect(b.residualAnchor).toBe(b.cipHeldAnchor);
    expect(corpLiquidInc(written.corpBulk[0])).toBe(500_000);
  });

  it("covers in full even when the treasury goes negative (soft-budget, equal legs)", async () => {
    const corpId = new ObjectId();
    // Treasury holds 100 against a 500k cover. The debit is unconditional.
    const { db, written } = makeDb(
      [makeCorp(corpId, { liquidCapital: -500_000 })],
      [makeSector(corpId)]
    );

    await processSoeOperations(db, NOW, 1953, new Map([[corpId.toString(), -500_000]]));

    const debit = written.budgetIncs.find((w) => treasuryDelta(w.update) !== undefined);
    expect(treasuryDelta(debit!.update)).toBe(-500_000);
    const ledgerAfter = 100 + treasuryDelta(debit!.update)!;
    expect(ledgerAfter).toBeLessThan(0); // negative-going, not withheld
    expect(corpLiquidInc(written.corpBulk[0])).toBe(500_000);
    expect(-treasuryDelta(debit!.update)!).toBe(corpLiquidInc(written.corpBulk[0]));
  });

  it("LOUD FAILURE: a treasury failure throws before any corp is credited", async () => {
    const corpId = new ObjectId();
    const { db, written } = makeDb(
      [makeCorp(corpId, { liquidCapital: -500_000 })],
      [makeSector(corpId)],
      { treasuryFail: true }
    );

    await expect(
      processSoeOperations(db, NOW, 1953, new Map([[corpId.toString(), -500_000]]))
    ).rejects.toThrow("treasury store down");
    // Treasury-first ordering: no corp credit without the treasury debit.
    expect(written.corpBulk).toHaveLength(0);
  });

  it("uses the margin estimate as an explicit fallback when the realized map is unavailable", async () => {
    const corpId = new ObjectId();
    const sector = makeSector(corpId, {
      revenue: 240_000,
      realizedRevenue: 240_000,
      profitMargin: 12,
      effectiveProfitMargin: -52,
    });
    const { db } = makeDb([makeCorp(corpId, { liquidCapital: -5_000_000 })], [sector]);

    const result = await processSoeOperations(db, NOW, 1953);

    const [b] = result.backing;
    expect(b.realizedSource).toBe("estimate");
    expect(b.coveredAnchor).toBeCloseTo((240_000 * 0.52) / TURNS_PER_DAY, 6);
    expect(b.coveredAnchor).toBeLessThan(b.shortfallAnchor);
  });

  it("does not forgive legacy holes: cover is capped at one turn of realized loss", async () => {
    const corpId = new ObjectId();
    // 50M accumulated hole, 500k of it from this turn. No CIP on the books
    // (landed builds are already out of CIP) — the 49.5M stays put.
    const { db } = makeDb([makeCorp(corpId, { liquidCapital: -50_000_000 })], [makeSector(corpId)]);

    const result = await processSoeOperations(
      db,
      NOW,
      1953,
      new Map([[corpId.toString(), -500_000]])
    );

    const [b] = result.backing;
    expect(b.coveredAnchor).toBe(500_000);
    expect(b.residualAnchor).toBe(49_500_000);
    expect(b.cipHeldAnchor).toBe(0);
  });
});

describe("120-turn upkeep-heavy loop (the #2043 shape)", () => {
  it("residual equals held CIP and treasury/corp legs reconcile every turn", async () => {
    // Drives the SHIPPED path per turn — processSoeOperations with this turn's
    // snapshot income, then foldSoeCashDeltas — not the bare cover pure
    // function. One 200k build order outstanding for the whole horizon; every
    // turn the enterprise loses 400k operating on an upkeep-heavy sector whose
    // margin estimate sees only a fraction of it (the #2043 under-cover), and
    // the treasury covers exactly that turn's realized loss.
    //
    // Snapshot incomes are supplied (the upkeep-to-income link inside
    // sectorCalculations is closed by the owed worldsim run, not here); what
    // this loop proves is the multi-turn composition: cover math, CIP naming,
    // leg equality, and the history-shape fold, every turn for 120 turns.
    const CIP = 200_000;
    const LOSS = 400_000;
    const corpId = new ObjectId();
    const corp = makeCorp(corpId, { liquidCapital: -CIP });
    const sector = makeSector(corpId, {
      revenue: 240_000,
      realizedRevenue: 240_000,
      profitMargin: 12,
      effectiveProfitMargin: -52,
      constructionInProgressAnchor: CIP,
    });
    const { db, written } = makeDb([corp], [sector]);
    // The build drain happened before the loop: cash opens at exactly -CIP.
    let cash = -CIP;
    let treasuryOut = 0;
    for (let turn = 0; turn < 120; turn++) {
      cash -= LOSS; // operating loss accrues (build cash left long ago)
      corp.liquidCapital = cash; // mirror of the corp-turn $inc, pre-backing
      const result = await processSoeOperations(
        db,
        NOW,
        1953,
        new Map([[corpId.toString(), -LOSS]])
      );
      expect(result.backing).toHaveLength(1);
      const [b] = result.backing;
      expect(b.realizedSource).toBe("snapshot");
      expect(b.shortfallAnchor).toBe(-cash);
      expect(b.coveredAnchor).toBe(LOSS);
      expect(b.cipHeldAnchor).toBe(CIP);
      // The residual is EXACTLY the held construction spend, every turn —
      // the same invariant the worldsim checklist query asserts per history row.
      expect(b.residualAnchor).toBe(CIP);
      expect(b.residualAnchor).toBe(b.cipHeldAnchor);
      // The old estimate-preferred path would have under-covered THIS turn on
      // THIS sector: pin the discriminator continuously, not just once.
      const estimated = estimateSoeOperatingLossAnchor({
        corporation: corp,
        sectors: [sector],
        corpOverheadAnchor: 0,
        fxByCurrency: new Map(),
      });
      expect(estimated).toBeGreaterThan(0);
      expect(estimated).toBeLessThan(LOSS);
      expect(b.coveredAnchor).toBeGreaterThan(estimated);
      // Equal legs this turn: last treasury debit funds the last corp credit.
      const debits = written.budgetIncs.filter((w) => treasuryDelta(w.update) !== undefined);
      const credits = written.corpBulk.filter((op) => corpLiquidInc(op) !== undefined);
      expect(-treasuryDelta(debits[debits.length - 1].update)!).toBe(LOSS);
      expect(corpLiquidInc(credits[credits.length - 1])).toBe(LOSS);
      treasuryOut += LOSS;
      // Fold into the history-shape snapshot: post-backing cash with the
      // reconciliation beside it, exactly what corporationHistory persists.
      const snapshots = [{ corpId, liquidCapital: cash } as unknown as CorpSnapshot];
      foldSoeCashDeltas({
        corpSnapshots: snapshots,
        corpById: new Map([[corpId.toString(), corp]]),
        backing: result.backing,
        remittedLocalByCorpId: new Map(),
      });
      expect(snapshots[0].liquidCapital).toBe(cash + LOSS);
      expect(snapshots[0].soeBacking).toMatchObject({
        realizedSource: "snapshot",
        coveredAnchor: LOSS,
        cipHeldAnchor: CIP,
        residualAnchor: CIP,
      });
      cash += LOSS; // mirror of the corp credit for the next turn's base
      corp.liquidCapital = cash;
    }
    // The hole never accumulates: 120 turns of losses, cash still just -CIP.
    expect(cash).toBe(-CIP);
    expect(treasuryOut).toBe(120 * LOSS);
  });
});

function backingEntry(overrides: Partial<SoeCorpBacking> = {}): SoeCorpBacking {
  return {
    corpId: new ObjectId(),
    countryId: "RU",
    shortfallAnchor: 700_000,
    realizedLossAnchor: 500_000,
    realizedSource: "snapshot",
    coveredAnchor: 500_000,
    coveredLocal: 500_000,
    cipHeldAnchor: 200_000,
    residualAnchor: 200_000,
    ...overrides,
  };
}

describe("foldSoeCashDeltas", () => {
  it("folds backing credits and remittance debits into snapshots and syncs the corp map", () => {
    const corpId = new ObjectId();
    const snapshots = [
      {
        corpId,
        income: -500_000,
        liquidCapital: 1_000_000,
      } as unknown as CorpSnapshot,
    ];
    // The corp map is turn-start stale (pre-turn cash 1.4M); the snapshot
    // already carries this turn's operating result.
    const corpById = new Map([[corpId.toString(), makeCorp(corpId, { liquidCapital: 1_400_000 })]]);

    foldSoeCashDeltas({
      corpSnapshots: snapshots,
      corpById,
      backing: [backingEntry({ corpId, coveredLocal: 500_000 })],
      remittedLocalByCorpId: new Map([[corpId.toString(), 100_000]]),
    });

    // Post-backing, post-remittance cash — not the stale pre-backing figure.
    expect(snapshots[0].liquidCapital).toBe(1_400_000);
    expect(snapshots[0].soeBacking).toMatchObject({
      shortfallAnchor: 700_000,
      realizedLossAnchor: 500_000,
      realizedSource: "snapshot",
      coveredAnchor: 500_000,
      cipHeldAnchor: 200_000,
      residualAnchor: 200_000,
    });
    // The corp doc syncs TO the folded snapshot, it is not incremented.
    expect(corpById.get(corpId.toString())!.liquidCapital).toBe(1_400_000);
  });
});

describe("buildSoeBackingAuditEntry", () => {
  it("is deterministic and aggregates the sweep", () => {
    const a = buildSoeBackingAuditEntry({ backing: [backingEntry()], remittedCorps: 2 });
    const b = buildSoeBackingAuditEntry({ backing: [backingEntry()], remittedCorps: 2 });
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      source: "turn",
      category: "corp",
      action: "corp.soe_backing_sweep",
      phase: "corporationTurn",
      outcome: "ok",
      meta: {
        corpsBacked: 1,
        corpsWithResidual: 1,
        realizedFromSnapshot: 1,
        realizedFromEstimate: 0,
        coveredAnchor: 500_000,
        residualAnchor: 200_000,
        remittedCorps: 2,
      },
    });
  });

  it("returns null when neither leg moved anything", () => {
    expect(buildSoeBackingAuditEntry({ backing: [], remittedCorps: 0 })).toBeNull();
  });
});

function minimalSnapshot(corpId: ObjectId, overrides: Partial<CorpSnapshot> = {}): CorpSnapshot {
  return {
    corpId,
    revenue: 1_000_000,
    totalCosts: 1_500_000,
    incomePreDividends: -500_000,
    income: -500_000,
    perTurnBondCouponIncome: 0,
    perTurnBondInterestExpense: 0,
    perTurnBondDragOnNetIncome: 0,
    liquidCapitalAnchorAfterIncome: -200_000,
    dividendPaidPerTurn: 0,
    federalTaxPaid: 0,
    stateTaxPaid: 0,
    taxPaidByCountry: new Map(),
    taxPaidByState: new Map(),
    taxPaidByCountryDomestic: new Map(),
    taxPaidByCountryForeign: new Map(),
    taxPaidByStateDomestic: new Map(),
    taxPaidByStateForeign: new Map(),
    marketingStrength: 0,
    logisticsStrength: 0,
    rdScore: 0,
    dividendRate: 0,
    liquidCapital: -200_000,
    escrowFundingMove: 0,
    escrowBalanceAfter: 0,
    actualSharePrice: 10,
    totalShares: 1_000,
    sectorNPV: 0,
    creditComposite: 50,
    creditRating: "BBB",
    ...overrides,
  };
}

describe("corporationHistory persistence", () => {
  it("persists the typed soeBacking reconciliation on history rows", async () => {
    const corpId = new ObjectId();
    const inserted: Record<string, unknown>[] = [];
    const db = {
      collection: (name: string) => {
        if (name === "corporationHistory") {
          return {
            aggregate: () => ({ toArray: async () => [] }),
            insertMany: async (docs: Record<string, unknown>[]) => {
              inserted.push(...docs);
              return {};
            },
          };
        }
        if (name === "marketCapHistory") {
          return { findOne: async () => null, replaceOne: async () => ({}) };
        }
        return {
          findOne: async () => null,
          find: () => ({ toArray: async () => [] }),
          bulkWrite: async () => ({}),
          updateOne: async () => ({}),
        };
      },
    } as unknown as Db;
    const corp = makeCorp(corpId, { sharePrice: 10, totalShares: 1_000 });
    const snapshots = [
      minimalSnapshot(corpId, {
        liquidCapital: -200_000,
        soeBacking: {
          shortfallAnchor: 700_000,
          realizedLossAnchor: 500_000,
          realizedSource: "snapshot",
          coveredAnchor: 500_000,
          cipHeldAnchor: 200_000,
          residualAnchor: 200_000,
        },
      }),
    ];

    await snapshotMarketCap(
      db,
      42,
      [corp],
      snapshots,
      new Map([[corpId.toString(), corp]]),
      new Map(),
      NOW,
      () => 0.5
    );

    expect(inserted).toHaveLength(1);
    // Post-backing cash is what history charts, with the reconciliation beside it.
    expect(inserted[0].liquidCapital).toBe(-200_000);
    expect(inserted[0].soeBacking).toEqual({
      shortfall: 700_000,
      realizedLoss: 500_000,
      realizedSource: "snapshot",
      covered: 500_000,
      cipHeld: 200_000,
      residual: 200_000,
    });
  });
});
