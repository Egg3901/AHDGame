/**
 * Pure synthetic market-demand computation.
 *
 * Phase 2 contract: deterministic function of `SovereignDemandSnapshot`.
 * Returns the scalar demand ratio plus per-component contributions for UI.
 *
 * Phase 3 will compose this with entity-holdings contribution (capped) to
 * produce the full demand signal.
 *
 * Design reference: docs/plans/archive/2026-05/2026-05-04-sovereign-default-design.md
 * Section 3 — Trigger & crisis detection.
 */

import {
  BASE_DEMAND,
  COUPON_PREMIUM_RATE,
  DEFAULT_SCAR_DURATION,
  DEFAULT_SCAR_PER_TURN,
  DGDP_CLIFF_FLOOR,
  DGDP_CLIFF_RATE,
  DGDP_PENALTY_FLOOR,
  DGDP_PENALTY_RATE,
  ENTITY_DEMAND_CAP,
  ENTITY_DEMAND_WEIGHT,
  FX_DEPREC_PENALTY_RATE,
  GLOBAL_BENCHMARK_RATE,
  INFLATION_PENALTY_FLOOR,
  INFLATION_PENALTY_RATE,
  TRUST_MODIFIER_RATE,
} from "./constants";
import type {
  SovereignDemandComponent,
  SovereignDemandResult,
  SovereignDemandSnapshot,
} from "./types";

export function computeMarketDemand(snap: SovereignDemandSnapshot): SovereignDemandResult {
  const components: SovereignDemandComponent[] = [];

  // Base appetite — slight oversubscription baseline
  components.push({ id: "base", label: "Base appetite", contribution: BASE_DEMAND });

  // Debt-to-GDP graduated penalty above 60%
  const dgdpPenalty =
    snap.debtToGdp > DGDP_PENALTY_FLOOR
      ? -(snap.debtToGdp - DGDP_PENALTY_FLOOR) * DGDP_PENALTY_RATE
      : 0;
  components.push({ id: "debtToGdp", label: "Debt-to-GDP penalty", contribution: dgdpPenalty });

  // Debt-to-GDP cliff penalty above 200% (additive on top of graduated)
  const dgdpCliff =
    snap.debtToGdp > DGDP_CLIFF_FLOOR ? -(snap.debtToGdp - DGDP_CLIFF_FLOOR) * DGDP_CLIFF_RATE : 0;
  components.push({
    id: "debtToGdpCliff",
    label: "Debt-to-GDP cliff (>200%)",
    contribution: dgdpCliff,
  });

  // Inflation penalty above 5%
  const inflationPenalty =
    snap.inflationRate > INFLATION_PENALTY_FLOOR
      ? -(snap.inflationRate - INFLATION_PENALTY_FLOOR) * INFLATION_PENALTY_RATE
      : 0;
  components.push({
    id: "inflation",
    label: "Inflation penalty",
    contribution: inflationPenalty,
  });

  // FX depreciation — only penalize, never reward appreciation
  const fxPenalty =
    snap.fxDepreciationRate10t > 0 ? -snap.fxDepreciationRate10t * FX_DEPREC_PENALTY_RATE : 0;
  components.push({
    id: "fxDepreciation",
    label: "FX depreciation penalty",
    contribution: fxPenalty,
  });

  // Default scar — linear decay from -1.0 (just-defaulted) to 0 at SCAR_DURATION turns
  const scarPenalty =
    snap.turnsSinceLastDefault !== null && snap.turnsSinceLastDefault < DEFAULT_SCAR_DURATION
      ? -(DEFAULT_SCAR_DURATION - snap.turnsSinceLastDefault) * DEFAULT_SCAR_PER_TURN
      : 0;
  components.push({ id: "defaultScar", label: "Default scar", contribution: scarPenalty });

  // Trust modifier — centered at 0.5; +/- 0.20 at extremes
  const trustModifier = (snap.trust - 0.5) * TRUST_MODIFIER_RATE;
  components.push({ id: "trust", label: "Trust modifier", contribution: trustModifier });

  // Coupon premium — country can buy demand by offering yields above benchmark.
  // sovereignCouponRate is in percentage points (e.g. 5.0 = 5%); GLOBAL_BENCHMARK_RATE
  // is a fraction (0.04 = 4%). Convert to common units before differencing.
  const yieldPremium = snap.sovereignCouponRate / 100 - GLOBAL_BENCHMARK_RATE;
  const couponContribution = yieldPremium * COUPON_PREMIUM_RATE;
  components.push({
    id: "couponPremium",
    label: "Coupon premium",
    contribution: couponContribution,
  });

  // Model B — entity-participation contribution (capped). Domestic + foreign
  // entity holdings of this country's sovereign bonds prop up demand. Capped
  // so entity holdings can never single-handedly mask catastrophic fundamentals.
  const entityContributionRaw =
    snap.requiredIssuance > 0
      ? (snap.entityHoldings / snap.requiredIssuance) * ENTITY_DEMAND_WEIGHT
      : 0;
  const entityContribution = Math.min(entityContributionRaw, ENTITY_DEMAND_CAP);
  components.push({
    id: "entityHoldings",
    label: "Entity holdings (Model B)",
    contribution: entityContribution,
  });

  const sum = components.reduce((acc, c) => acc + c.contribution, 0);
  const demandRatio = Math.max(0, sum);

  return { demandRatio, components };
}
