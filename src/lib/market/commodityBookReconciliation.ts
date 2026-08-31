import type { CommodityType } from "@/lib/constants/commodities";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { CommoditySourcingDoc } from "@/lib/logistics/sourcingLedger";

export type CommodityMeasurementBasis =
  | CommodityFlow["basis"]
  | CommodityFlow["clearingBasis"]
  | CommodityFlow["byCountry"][string]["basis"]
  | CommoditySourcingDoc["basis"];

export interface BasisMeasurement<Basis extends CommodityMeasurementBasis> {
  basis: Basis;
  units: number;
}

export interface CommodityBookExplanation {
  code:
    | "pre_calibration_intent_vs_calibrated_ledger"
    | "reachable_intent_vs_pooled_world_balance"
    | "pooled_min_is_not_sum_of_scoped_minima";
  summary: string;
}

export interface CommodityBookReconciliation {
  turns: {
    ledger: number[];
    sourcing: number[];
    aligned: boolean;
  };
  coverage: {
    ledgerCommodities: CommodityType[];
    sourcingCommodities: CommodityType[];
    sharedCommodities: CommodityType[];
    /** Docs predating the basis markers (retention window); empty once all rows are re-written. */
    unmarkedBases: string[];
  };
  worldDemand: {
    /** The divergence below is computed over commodities BOTH books carry. */
    basket: "shared";
    ledger: BasisMeasurement<"ledger_aggregate">;
    sourcing: BasisMeasurement<"buyer_intent_sourcing">;
    divergenceUnits: number;
    divergencePctOfLedger: number | null;
    /** Each book's own full total, for reference; not comparable to each other. */
    fullBasket: { ledgerAllCommodities: number; sourcingShippedOnly: number };
    explanation: CommodityBookExplanation;
  };
  clearing: {
    pooled: BasisMeasurement<"global_pooled_availability">;
    countryScoped: BasisMeasurement<"country_scoped_ledger">;
    divergenceUnits: number;
    divergencePctOfPooled: number | null;
    explanation: CommodityBookExplanation;
  };
  byCommodity: Record<
    string,
    {
      demand: {
        ledger: BasisMeasurement<"ledger_aggregate">;
        sourcing: BasisMeasurement<"buyer_intent_sourcing">;
        divergenceUnits: number;
        divergencePctOfLedger: number | null;
        explanation: CommodityBookExplanation;
      };
      unmetDemand: {
        ledger: BasisMeasurement<"global_pooled_availability">;
        sourcing: BasisMeasurement<"buyer_intent_sourcing">;
        divergenceUnits: number;
        divergencePctOfLedger: number | null;
        explanation: CommodityBookExplanation;
      };
    }
  >;
}

const DEMAND_EXPLANATION: CommodityBookExplanation = {
  code: "pre_calibration_intent_vs_calibrated_ledger",
  summary:
    "Sourcing records state buyer intent before era calibration and freight demand, while the ledger records the later calibrated global aggregate.",
};

const UNMET_EXPLANATION: CommodityBookExplanation = {
  code: "reachable_intent_vs_pooled_world_balance",
  summary:
    "Sourcing leaves intent unmet when reachable sellers, landed-price tolerance, or freight capacity cannot serve it; the pooled ledger lets any world supply offset any world demand.",
};

const CLEARING_EXPLANATION: CommodityBookExplanation = {
  code: "pooled_min_is_not_sum_of_scoped_minima",
  summary:
    "Global clearing is min of world supply and demand, while country-scoped clearing sums each country's separate minimum. Surplus in one scope does not automatically settle deficit in another.",
};

function percentOf(divergence: number, basis: number): number | null {
  return basis === 0 ? null : (divergence / basis) * 100;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Collects docs that predate the basis markers instead of throwing. The flow
 * ledger is retained for COMMODITY_FLOW_RETENTION_TURNS, so for a full
 * retention window after deploy this helper will legitimately meet unmarked
 * rows; throwing would make it unusable against live data exactly when it is
 * most wanted.
 */
function collectUnmarkedBases(
  ledger: readonly CommodityFlow[],
  sourcing: readonly CommoditySourcingDoc[]
): string[] {
  const unmarked: string[] = [];
  for (const doc of ledger) {
    if (doc.basis !== "ledger_aggregate") {
      unmarked.push(`ledger:${doc.commodity}:basis=${doc.basis ?? "missing"}`);
    }
    if (doc.clearingBasis !== "global_pooled_availability") {
      unmarked.push(`ledger:${doc.commodity}:clearingBasis=${doc.clearingBasis ?? "missing"}`);
    }
    for (const [countryId, row] of Object.entries(doc.byCountry)) {
      if (row.basis !== "country_scoped_ledger") {
        unmarked.push(`ledger:${doc.commodity}/${countryId}:basis=${row.basis ?? "missing"}`);
      }
    }
  }
  for (const doc of sourcing) {
    if (doc.basis !== "buyer_intent_sourcing") {
      unmarked.push(`sourcing:${doc.commodity}:basis=${doc.basis ?? "missing"}`);
    }
  }
  return unmarked;
}

/**
 * Compare the persisted commodity ledger and sourcing books without trying to
 * make them agree.
 *
 * The helper reads only basis-explicit fields. Its output keeps each value
 * paired with the basis that produced it, reports signed divergence, and names
 * why the divergence is expected. Positive demand and unmet-demand divergence
 * means sourcing is higher than the ledger. Positive clearing divergence means
 * pooled availability is higher than the sum of country-scoped clearing.
 *
 * Callers should pass one coherent snapshot per book. `turns.aligned` and
 * `coverage` make stale snapshots or different commodity coverage visible
 * instead of silently claiming an apples-to-apples comparison.
 */
export function reconcileCommodityBooks(input: {
  ledger: readonly CommodityFlow[];
  sourcing: readonly CommoditySourcingDoc[];
}): CommodityBookReconciliation {
  const { ledger, sourcing } = input;
  const unmarkedBases = collectUnmarkedBases(ledger, sourcing);

  const ledgerByCommodity = new Map(ledger.map((doc) => [doc.commodity, doc]));
  const sourcingByCommodity = new Map(sourcing.map((doc) => [doc.commodity, doc]));
  const ledgerCommodities = [...ledgerByCommodity.keys()].sort();
  const sourcingCommodities = [...sourcingByCommodity.keys()].sort();
  const sharedCommodities = ledgerCommodities.filter((commodity) =>
    sourcingByCommodity.has(commodity)
  );

  // The two books cover different baskets: the ledger carries every commodity
  // while the sourcing book only carries the shipped ones. Comparing their full
  // totals would publish a divergence that is partly just basket mismatch, so
  // the headline divergence is computed over the SHARED basket and each book's
  // own full-basket total is reported separately, named.
  const sharedSet = new Set(sharedCommodities);
  const ledgerDemandShared = ledger.reduce(
    (sum, doc) => (sharedSet.has(doc.commodity) ? sum + doc.demandUnitsLedger : sum),
    0
  );
  const sourcingDemandShared = sourcing.reduce(
    (sum, doc) => (sharedSet.has(doc.commodity) ? sum + doc.demandUnitsIntent : sum),
    0
  );
  const demandDivergence = sourcingDemandShared - ledgerDemandShared;
  const ledgerDemandAllCommodities = ledger.reduce((sum, doc) => sum + doc.demandUnitsLedger, 0);
  const sourcingDemandAllCommodities = sourcing.reduce(
    (sum, doc) => sum + doc.demandUnitsIntent,
    0
  );

  const pooledClearing = ledger.reduce((sum, doc) => sum + doc.clearedUnitsPooled, 0);
  const countryScopedClearing = ledger.reduce(
    (sum, doc) =>
      sum +
      Object.values(doc.byCountry).reduce(
        (countrySum, row) => countrySum + row.clearedUnitsScoped,
        0
      ),
    0
  );
  const clearingDivergence = pooledClearing - countryScopedClearing;

  const byCommodity: CommodityBookReconciliation["byCommodity"] = {};
  for (const commodity of sharedCommodities) {
    const ledgerDoc = ledgerByCommodity.get(commodity)!;
    const sourcingDoc = sourcingByCommodity.get(commodity)!;
    const commodityDemandDivergence = sourcingDoc.demandUnitsIntent - ledgerDoc.demandUnitsLedger;
    const commodityUnmetDivergence = sourcingDoc.unmetUnits - ledgerDoc.unmetDemandUnitsPooled;
    byCommodity[commodity] = {
      demand: {
        ledger: { basis: ledgerDoc.basis, units: ledgerDoc.demandUnitsLedger },
        sourcing: { basis: sourcingDoc.basis, units: sourcingDoc.demandUnitsIntent },
        divergenceUnits: commodityDemandDivergence,
        divergencePctOfLedger: percentOf(commodityDemandDivergence, ledgerDoc.demandUnitsLedger),
        explanation: DEMAND_EXPLANATION,
      },
      unmetDemand: {
        ledger: {
          basis: ledgerDoc.clearingBasis,
          units: ledgerDoc.unmetDemandUnitsPooled,
        },
        sourcing: { basis: sourcingDoc.basis, units: sourcingDoc.unmetUnits },
        divergenceUnits: commodityUnmetDivergence,
        divergencePctOfLedger: percentOf(
          commodityUnmetDivergence,
          ledgerDoc.unmetDemandUnitsPooled
        ),
        explanation: UNMET_EXPLANATION,
      },
    };
  }

  const ledgerTurns = uniqueSorted(ledger.map((doc) => doc.turn));
  const sourcingTurns = uniqueSorted(sourcing.map((doc) => doc.turn));

  return {
    turns: {
      ledger: ledgerTurns,
      sourcing: sourcingTurns,
      aligned:
        ledgerTurns.length === 1 &&
        sourcingTurns.length === 1 &&
        ledgerTurns[0] === sourcingTurns[0],
    },
    coverage: { ledgerCommodities, sourcingCommodities, sharedCommodities, unmarkedBases },
    worldDemand: {
      basket: "shared",
      ledger: { basis: "ledger_aggregate", units: ledgerDemandShared },
      sourcing: { basis: "buyer_intent_sourcing", units: sourcingDemandShared },
      divergenceUnits: demandDivergence,
      divergencePctOfLedger: percentOf(demandDivergence, ledgerDemandShared),
      explanation: DEMAND_EXPLANATION,
      fullBasket: {
        ledgerAllCommodities: ledgerDemandAllCommodities,
        sourcingShippedOnly: sourcingDemandAllCommodities,
      },
    },
    clearing: {
      pooled: { basis: "global_pooled_availability", units: pooledClearing },
      countryScoped: { basis: "country_scoped_ledger", units: countryScopedClearing },
      divergenceUnits: clearingDivergence,
      divergencePctOfPooled: percentOf(clearingDivergence, pooledClearing),
      explanation: CLEARING_EXPLANATION,
    },
    byCommodity,
  };
}
