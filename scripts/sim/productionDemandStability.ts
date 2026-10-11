/**
 * Deterministic qualification of production feedback against the previous
 * delayed-fill/unshared-headroom behavior. Synthetic state only, no database.
 * This is a scoped rules experiment, not a whole-world economic qualification.
 * Run: npx tsx scripts/sim/productionDemandStability.ts
 */
import { pathToFileURL } from "node:url";
import { computeClearingFactors } from "../../src/lib/market/clearing";
import {
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
  type CommodityType,
} from "../../src/lib/constants/commodities";
import { computeContractProduction } from "../../src/lib/turn/corporation/contractProduction";
import {
  soldOutMarketHeadroomUnits,
  throttleSoldUnits,
} from "../../src/lib/turn/corporation/rules/demandThrottle";

export function productionTrajectory(candidate: boolean, mixed: boolean, shock: boolean) {
  const supply: Partial<Record<CommodityType, number>> = mixed
    ? { freight: 0.75, consulting_services: 0.25 }
    : { freight: 1 };
  const capacity = Array.from({ length: 61 }, (_, i) => 500 + i * 20);
  let produced = capacity.map((value) => value * 0.3);
  let savedSold = [...produced];
  let savedFill = capacity.map(() =>
    Object.fromEntries(Object.keys(supply).map((key) => [key, 1]))
  );
  const rows: { turn: number; produced: number; demand: number; sold: number }[] = [];
  for (let turn = 1; turn <= 120; turn++) {
    const demand = 45_000 * (shock && turn >= 41 && turn <= 80 ? 0.5 : 1);
    const total = produced.reduce((sum, value) => sum + value, 0);
    const balances = new Map(
      Object.keys(supply).map((rawKey) => {
        const key = rawKey as CommodityType;
        const weight = commodityMixWeight(supply, COMMODITY_BASE_PRICES, key);
        return [key, { supply: total * weight, demand: demand * weight }] as const;
      })
    );
    const results = computeClearingFactors({
      sectors: produced.map((value, i) => ({
        sectorId: String(i),
        revenue: value * 1000,
        supplyRates: supply,
        producedUnits: value,
        posture: 0,
      })),
      balances,
      basePrices: COMMODITY_BASE_PRICES,
      priceRatioByCommodity: new Map(Object.keys(supply).map((key) => [key as CommodityType, 1])),
      plantsEnabled: true,
    });
    const next = produced.map((value, i) => {
      const cleared = results.get(String(i))!;
      const fill = candidate ? cleared.soldByCommodity! : savedFill[i];
      const sold = throttleSoldUnits({
        producedUnits: value,
        soldUnits: candidate ? value * cleared.soldFraction : savedSold[i],
        soldByCommodity: fill,
        supplyRates: supply,
        priceRatioFor: () => 1,
      });
      const headroom = soldOutMarketHeadroomUnits({
        soldByCommodity: fill,
        supplyRates: supply,
        mixWeightFor: (key) =>
          commodityMixWeight(supply, COMMODITY_BASE_PRICES, key as CommodityType),
        balanceFor: (key) => balances.get(key as CommodityType),
        priceRatioFor: () => 1,
        marketShareFor: (key) =>
          candidate ? cleared.marketSupplyShareByCommodity?.[key as CommodityType] : 1,
      });
      return computeContractProduction({
        plantsEnabled: true,
        actualNameplateUnits: capacity[i],
        actualProductionFactor: 1,
        fullPolicyNameplateUnits: capacity[i],
        involuntaryProductionFactor: 1,
        priorProducedUnits: value,
        priorSoldUnits: sold,
        marketHeadroomUnits: headroom,
        soldFraction: cleared.soldFraction,
      });
    });
    rows.push({
      turn,
      produced: next.reduce((sum, value) => sum + value.producedUnits, 0),
      demand,
      sold: Math.min(total, demand),
    });
    produced = next.map((value) => value.producedUnits);
    savedSold = next.map((value) => value.soldUnits);
    savedFill = produced.map((_, i) => results.get(String(i))!.soldByCommodity!);
  }
  return rows;
}

export function productionStabilityReport() {
  const scenarios = [false, true].flatMap((mixed) =>
    [false, true].map((shock) => {
      const baseline = productionTrajectory(false, mixed, shock);
      const candidate = productionTrajectory(true, mixed, shock);
      const span = (rows: typeof candidate) => {
        const values = rows.slice(-24).map((row) => row.produced);
        return Math.max(...values) - Math.min(...values);
      };
      return {
        mixed,
        shock,
        turns: candidate.length,
        baselineSpan: span(baseline),
        candidateSpan: span(candidate),
        lastProduction: candidate.at(-1)!.produced,
        lastDemand: candidate.at(-1)!.demand,
      };
    })
  );
  return {
    scope:
      "61 synthetic producers; actual clearing and production rules; 120 turns; terminal window 24 turns; constant demand and 40-turn demand shock; single and mixed outputs",
    limitations:
      "Not a full-world replay. Input-price feedback, trade graph changes, labour and revenue governor are not modeled. No live database used. Whole-phase performance and aged-world qualification remain separate gates.",
    scenarios,
    passed: scenarios.every(
      (row) =>
        row.candidateSpan < 0.001 &&
        row.candidateSpan < row.baselineSpan &&
        row.lastProduction <= row.lastDemand * 1.15 + 0.001
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = productionStabilityReport();
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
