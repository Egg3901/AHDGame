import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";

export type EconomicStressScenario =
  | "largest_supplier_failure"
  | "freight_capacity_shock"
  | "exchange_closure"
  | "synchronized_liquidation"
  | "dormant_balance_reactivation";

export interface EconomicStressFinding {
  scenario: EconomicStressScenario;
  severity: "low" | "moderate" | "high" | "critical";
  firstFailure: string;
  propagationPath: string[];
  unmetDemandUnits: number | null;
  balanceSheetLossAnchor: number | null;
  recoveryTurns: number;
  indicators: Record<string, number | null>;
  basis: string;
}

export interface EconomicStressAssumptions {
  freightCapacityLossShare: number;
  freightShockTurns: number;
  exchangeClosureTurns: number;
  liquidationShareOfMarketCap: number;
  dormantBalanceReactivationShare: number;
}

const DEFAULT_ASSUMPTIONS: EconomicStressAssumptions = {
  freightCapacityLossShare: 0.5,
  freightShockTurns: 12,
  exchangeClosureTurns: 12,
  liquidationShareOfMarketCap: 0.1,
  dormantBalanceReactivationShare: 0.5,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function severityForFill(fill: number | null): EconomicStressFinding["severity"] {
  if (fill == null) return "moderate";
  if (fill < 0.4) return "critical";
  if (fill < 0.6) return "high";
  if (fill < 0.8) return "moderate";
  return "low";
}

function largestSupplierFailure(snapshot: EconomicVitalSigns): EconomicStressFinding {
  const stressed = snapshot.competition.markets
    .filter(
      (market) => market.demandUnits > 0 && market.largestOwnershipAdjustedSellerShare != null
    )
    .map((market) => {
      const participantScale =
        market.participantSellerUnits > market.supplyUnits && market.participantSellerUnits > 0
          ? market.supplyUnits / market.participantSellerUnits
          : 1;
      const removedSupply = Math.min(
        market.supplyUnits,
        (market.largestOwnershipAdjustedSellerUnits ?? 0) * participantScale
      );
      const remainingSupply = market.supplyUnits - removedSupply;
      const fill = clamp01(remainingSupply / market.demandUnits);
      const unmet = Math.max(0, market.demandUnits - remainingSupply);
      return { market, fill, unmet, removedSupply };
    })
    .sort((a, b) => a.fill - b.fill || b.unmet - a.unmet);
  const worst = stressed[0];
  if (!worst) {
    return {
      scenario: "largest_supplier_failure",
      severity: "moderate",
      firstFailure: "unavailable",
      propagationPath: ["supplier ownership unavailable", "commodity market unmeasured"],
      unmetDemandUnits: null,
      balanceSheetLossAnchor: null,
      recoveryTurns: 24,
      indicators: { stressedFillRate: null, removedSupplyShare: null },
      basis: "No ownership-adjusted commodity sample was available.",
    };
  }
  return {
    scenario: "largest_supplier_failure",
    severity: severityForFill(worst.fill),
    firstFailure: `commodity:${worst.market.commodity}`,
    propagationPath: [
      "largest formalized ownership group",
      `commodity:${worst.market.commodity}`,
      "input-buying sectors",
      "downstream output",
    ],
    unmetDemandUnits: worst.unmet,
    balanceSheetLossAnchor:
      worst.market.priceAnchorPerUnit == null
        ? null
        : worst.unmet * worst.market.priceAnchorPerUnit,
    recoveryTurns: 24,
    indicators: {
      stressedFillRate: worst.fill,
      removedSupplyShare: worst.market.largestOwnershipAdjustedSellerShare,
      removedSupplyUnits: worst.removedSupply,
    },
    basis:
      "Static removal of the largest common-control seller; 24 turns is the declared replacement-capacity review horizon.",
  };
}

function freightCapacityShock(
  snapshot: EconomicVitalSigns,
  assumptions: EconomicStressAssumptions
): EconomicStressFinding {
  const fulfillment = snapshot.trade.intentFulfillmentRate.value;
  const localShare = snapshot.trade.localShare.value;
  const nonlocalShare =
    (snapshot.trade.interstateShare.value ?? 0) + (snapshot.trade.importShare.value ?? 0);
  const stressedFulfillment =
    fulfillment == null || localShare == null
      ? null
      : fulfillment *
        (localShare + nonlocalShare * (1 - clamp01(assumptions.freightCapacityLossShare)));
  return {
    scenario: "freight_capacity_shock",
    severity: severityForFill(stressedFulfillment),
    firstFailure: "nonlocal buyer-intent fulfillment",
    propagationPath: ["freight capacity", "interstate and import routes", "buyer inputs"],
    unmetDemandUnits: null,
    balanceSheetLossAnchor: null,
    recoveryTurns: assumptions.freightShockTurns + 12,
    indicators: {
      stressedIntentFulfillmentRate: stressedFulfillment,
      nonlocalFulfillmentShare: nonlocalShare,
    },
    basis:
      "Static haircut to interstate and import fulfillment; recovery includes the shock duration plus a 12-turn supply-chain normalization window.",
  };
}

function exchangeClosure(
  snapshot: EconomicVitalSigns,
  assumptions: EconomicStressAssumptions
): EconomicStressFinding {
  const dailyNotional = snapshot.securities.equityNotionalAnchor48Turns / 48;
  const trappedNotional = dailyNotional * assumptions.exchangeClosureTurns;
  return {
    scenario: "exchange_closure",
    severity:
      snapshot.securities.activeTradedListingShare.value != null &&
      snapshot.securities.activeTradedListingShare.value < 0.6
        ? "high"
        : "moderate",
    firstFailure: "secondary equity liquidity",
    propagationPath: ["exchange closure", "price discovery", "portfolio liquidity"],
    unmetDemandUnits: null,
    balanceSheetLossAnchor: trappedNotional,
    recoveryTurns: assumptions.exchangeClosureTurns + 12,
    indicators: {
      trappedNormalTurnNotionalAnchor: trappedNotional,
      activeTradedListingShare: snapshot.securities.activeTradedListingShare.value,
    },
    basis:
      "Loss is normal trading notional trapped during closure, not a mark-to-market write-down.",
  };
}

function synchronizedLiquidation(
  snapshot: EconomicVitalSigns,
  assumptions: EconomicStressAssumptions
): EconomicStressFinding {
  const offered =
    snapshot.firms.marketCapitalizationAnchor * assumptions.liquidationShareOfMarketCap;
  const absorbed = Math.min(offered, snapshot.securities.openOrderDepthAnchor);
  const unabsorbed = Math.max(0, offered - absorbed);
  const absorptionRate = offered > 0 ? absorbed / offered : null;
  return {
    scenario: "synchronized_liquidation",
    severity: severityForFill(absorptionRate),
    firstFailure: "open equity order-book depth",
    propagationPath: ["synchronized sell orders", "bid depth", "mark-to-market portfolios"],
    unmetDemandUnits: null,
    balanceSheetLossAnchor: unabsorbed,
    recoveryTurns: 24,
    indicators: { absorptionRate, unabsorbedNotionalAnchor: unabsorbed },
    basis:
      "Unabsorbed offered notional is liquidity exposure, not a forecast realized loss; 24 turns is the declared order-book recovery horizon.",
  };
}

function dormantBalanceReactivation(
  snapshot: EconomicVitalSigns,
  assumptions: EconomicStressAssumptions
): EconomicStressFinding {
  const dormant = snapshot.money.dormantModeledBalanceShare48.value;
  const demandImpulse =
    dormant == null ? null : dormant * clamp01(assumptions.dormantBalanceReactivationShare);
  return {
    scenario: "dormant_balance_reactivation",
    severity:
      demandImpulse == null
        ? "moderate"
        : demandImpulse > 0.2
          ? "high"
          : demandImpulse > 0.1
            ? "moderate"
            : "low",
    firstFailure: "goods-market absorption capacity",
    propagationPath: ["dormant balances", "transactional demand", "goods prices"],
    unmetDemandUnits: null,
    balanceSheetLossAnchor: null,
    recoveryTurns: 12,
    indicators: { broadMoneyDemandImpulseShare: demandImpulse },
    basis:
      "Demand impulse is a share of modeled broad balances. Cross-currency stocks are not summed into a false anchor-currency loss estimate.",
  };
}

export function runEconomicStressTests(
  snapshot: EconomicVitalSigns,
  overrides: Partial<EconomicStressAssumptions> = {}
): EconomicStressFinding[] {
  const assumptions = { ...DEFAULT_ASSUMPTIONS, ...overrides };
  return [
    largestSupplierFailure(snapshot),
    freightCapacityShock(snapshot, assumptions),
    exchangeClosure(snapshot, assumptions),
    synchronizedLiquidation(snapshot, assumptions),
    dormantBalanceReactivation(snapshot, assumptions),
  ];
}
