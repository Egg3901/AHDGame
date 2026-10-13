/** Deterministic synthetic pricing and internal-supply qualification. Never opens a database. */
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { COMMODITY_BASE_PRICES, COMMODITY_TYPES } from "../../src/lib/constants/commodities";
import { computeClearingFactors, clearCommodityMarket } from "../../src/lib/market/clearing";
import { priceRealizationFactor } from "../../src/lib/market/priceRealization";
import {
  allocateInternalSupply,
  internalSupplyDiscounts,
  resolveSupplyPolicies,
} from "../../src/lib/market/internalSupply/rules";
import { runInternalSupplyWorld } from "../../src/lib/test-utils/internalSupplyWorld";
import { TURNS_PER_DAY } from "../../src/lib/constants/turnTime";

const outfile = process.argv[2];
if (!outfile) throw new Error("Usage: tsx scripts/sim/internalSupplyAssessment.ts <report.json>");
const start = performance.now();
let assertions = 0;
const check = (value: unknown, message: string) => {
  assert(value, message);
  assertions++;
};
const curves = [-0.2, -0.1, 0, 0.1, 0.2].map((posture) => {
  const fills = [25, 50, 75, 100, 150, 200].map((demand) => {
    const result = clearCommodityMarket(demand, [
      { id: "target", units: 100, posture },
      { id: "rival", units: 100, posture: 0 },
    ]);
    return {
      demand,
      fill: result.get("target") ?? 0,
      revenueFactor: (result.get("target") ?? 0) * (1 + posture),
    };
  });
  return { posture, fills };
});
for (const commodity of COMMODITY_TYPES)
  for (const supply of [0, 20, 60, 100, 200])
    for (const demand of [10, 60, 100, 200]) {
      const policies = resolveSupplyPolicies([
        {
          id: "corp",
          totalShares: 1,
          holders: [{ shares: 1 }],
          policy: { priority: "own", discount: 0.1 },
        },
      ]);
      const buyers = [
        {
          sectorId: "factory",
          corporationId: "corp",
          demand: demand * 0.4,
          availability: Math.min(1, supply / demand),
        },
        {
          sectorId: "rival",
          corporationId: "outside",
          demand: demand * 0.6,
          availability: Math.min(1, supply / demand),
        },
      ];
      const result = allocateInternalSupply({
        policies,
        sellers: [{ sectorId: "mine", corporationId: "corp", units: supply }],
        buyers,
        supply,
        demand,
        reservationRoom: demand,
      });
      check(
        result.trades.reduce((n, t) => n + t.units, 0) <= Math.min(supply, demand * 0.4) + 1e-8,
        `${commodity}: finite internal supply`
      );
      const costs = internalSupplyDiscounts(
        result.trades,
        COMMODITY_BASE_PRICES[commodity],
        TURNS_PER_DAY
      );
      check(
        Math.abs([...costs.values()].reduce((n, c) => n + c, 0)) < 1e-7,
        `${commodity}: conserved discounts`
      );
      const base = {
        sectors: [
          {
            sectorId: "mine",
            revenue: supply * COMMODITY_BASE_PRICES[commodity],
            supplyRates: { [commodity]: 1 },
            posture: 0,
            producedUnits: supply,
          },
        ],
        balances: new Map([[commodity, { supply, demand }]]),
        priceRatioByCommodity: new Map(),
        basePrices: COMMODITY_BASE_PRICES,
        plantsEnabled: true,
      };
      const factors = computeClearingFactors(base);
      const filled = (factors.get("mine")?.soldFraction ?? 0) * supply;
      check(filled <= supply + 1e-8 && filled <= demand + 1e-8, `${commodity}: clearing ceiling`);
    }
const world = (
  priority: "market" | "own" | "group",
  discount: number,
  group = false,
  mothballed = false
) => {
  const r = runInternalSupplyWorld({ priority, discount }, { group, mothballed });
  return {
    priority,
    discount,
    group,
    mothballed,
    factoryProduced: r.updates[1]?.producedUnits ?? 0,
    factoryRevenueDaily: r.updates[1]?.plantsPnl?.revenue ?? 0,
    factoryProfitDaily: r.updates[1]?.plantsPnl?.profit ?? 0,
    factoryThroughput: r.updates[1]?.throughputFactor ?? 0,
    factoryReservedIron: r.updates[1]?.internalSupplyReceipt?.received.iron ?? 0,
    factoryConsumedIron: r.buyer.internalSupplyInputUnits?.get("iron") ?? null,
    sellerCostsPerTurn: r.seller.costs,
    buyerCostsPerTurn: r.buyer.costs,
    sellerDiscountDaily: r.updates[0]?.internalSupplyReceipt?.discountCostAnchor ?? 0,
    buyerDiscountDaily: r.updates[1]?.internalSupplyReceipt?.discountCostAnchor ?? 0,
  };
};
const worlds = [
  world("market", 0),
  world("own", 0),
  world("own", 0.1),
  world("own", 0.1, true),
  world("group", 0.1, true),
  world("own", 0.1, false, true),
];
check(
  worlds[1]!.factoryProduced > worlds[0]!.factoryProduced,
  "actual factory production increases"
);
check(
  Math.abs(worlds[2]!.sellerDiscountDaily + worlds[2]!.buyerDiscountDaily) < 1e-7,
  "actual consumed-input discounts cancel"
);
check(
  Math.abs(
    worlds[2]!.sellerCostsPerTurn +
      worlds[2]!.buyerCostsPerTurn -
      worlds[1]!.sellerCostsPerTurn -
      worlds[1]!.buyerCostsPerTurn
  ) < 1e-7,
  "actual operating cost conservation"
);
check(
  worlds[3]!.factoryReservedIron === 0 && worlds[4]!.factoryReservedIron > 0,
  "wholly owned group opt-in"
);
check(
  worlds[5]!.factoryReservedIron === 0 && worlds[5]!.buyerDiscountDaily === 0,
  "no phantom cold supply"
);
// User-approved Group Chain extension: retain benchmark cash budgets and
// prove matched actual-consumption discounts through the real plant turn.
const groupWorlds = [0, 0.05, 0.1, 0.2, 0.35].map((discount) => {
  const r = runInternalSupplyWorld(
    { priority: "market", discount: 0 },
    { group: true, coordinationDiscount: discount }
  );
  const charge = r.updates[0]?.internalSupplyReceipt?.discountCostAnchor ?? 0;
  const credit = r.updates[1]?.internalSupplyReceipt?.discountCostAnchor ?? 0;
  check(Math.abs(charge + credit) < 1e-7, "Group consumed discounts conserve money");
  check(discount === 0 || charge > 0, "Group discount reaches real operating accounts");
  return {
    discount,
    sellerCostsPerTurn: r.seller.costs,
    buyerCostsPerTurn: r.buyer.costs,
    supplierChargeDaily: charge,
    buyerCreditDaily: credit,
    sellerRevenuePerTurn: r.seller.hourlyRevenue,
    buyerProduced: r.updates[1]?.producedUnits ?? 0,
  };
});
for (const w of groupWorlds) {
  check(
    Math.abs(
      w.sellerCostsPerTurn +
        w.buyerCostsPerTurn -
        groupWorlds[0]!.sellerCostsPerTurn -
        groupWorlds[0]!.buyerCostsPerTurn
    ) < 1e-7,
    "Group discount does not create operating profit at fixed output"
  );
  check(
    w.sellerRevenuePerTurn === groupWorlds[0]!.sellerRevenuePerTurn &&
      w.buyerProduced === groupWorlds[0]!.buyerProduced,
    "Group discount does not bypass cash limits or change physical units"
  );
}
const report = {
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  generatedAt: new Date().toISOString(),
  qualification:
    "Synthetic deterministic market and actual clearing-to-sector-turn replay. No production data, no world trajectory or live deployment claim.",
  assertions,
  commodityCount: COMMODITY_TYPES.length,
  scenarios: COMMODITY_TYPES.length * 20,
  elapsedMs: performance.now() - start,
  additionalDatabaseReads: 0,
  curves,
  priceCurve: [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6].map((ratio) => ({
    ratio,
    realized: priceRealizationFactor(ratio),
  })),
  worlds,
  groupWorlds,
  verdict: "passed",
};
writeFileSync(outfile, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      assertions,
      scenarios: report.scenarios,
      commodityCount: report.commodityCount,
      worlds,
      elapsedMs: Math.round(report.elapsedMs),
    },
    null,
    2
  )
);
process.exit(0);
