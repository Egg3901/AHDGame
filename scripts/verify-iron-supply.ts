/**
 * One-off: verify the iron Top Producers fix.
 * Reports per-corp iron supply under both the OLD (pre-fix) and NEW (post-fix)
 * algorithms, alongside the headline globalSupply stored in commodityPrices.
 *
 * Usage: npx tsx scripts/verify-iron-supply.ts
 */
import type { ObjectId } from "mongodb";
import {
  COMMODITY_BASE_PRICES,
  NATCORP_COMMODITY_MULTIPLIER,
  SECTOR_SUPPLY,
  dollarsToUnits,
} from "../src/lib/constants/commodities";
import type { ExtractableResource } from "../src/lib/constants/commodities";
import { getEffectiveStrategyRates } from "../src/lib/constants/sectorStrategies";
import { getOutputMultiplier } from "../src/lib/utils/productionPolicy";
import {
  computeExtractionCapacityMultipliers,
  type ExtractionSectorInput,
} from "../src/lib/turn/extraction/extractionCapacity";
import { readCorpEconomicAnchor } from "../src/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "../src/lib/constants/currencies";
import { closeDb, connectDb } from "./utils/db";

const COMMODITY: ExtractableResource = "iron";

const COUNTRY_CURRENCY_MAP: Record<string, CurrencyCode> = {
  us: "USD",
  uk: "GBP",
  jp: "JPY",
  de: "EUR",
  ie: "EUR",
  cn: "CNY",
  br: "BRL",
} as const;

function resolveCorpCurrency(corp: {
  liquidCurrencyCode?: string;
  countryId?: string;
}): CurrencyCode {
  return (corp.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[corp.countryId ?? ""] ??
    "USD") as CurrencyCode;
}

async function main() {
  const db = await connectDb();

  const gameState = await db.collection<{ _id: string }>("gameState").findOne({ _id: "current" });
  const currentTurn: number = (gameState as { currentTurn?: number } | null)?.currentTurn ?? 1;

  const [priceDoc, allSectors, allCorps, exchangeRates, capacityDocs, contractDocs] =
    await Promise.all([
      db.collection("commodityPrices").findOne({ commodity: COMMODITY }),
      db.collection("corporateSectors").find({}).toArray(),
      db.collection("corporations").find({}).toArray(),
      db.collection("exchangeRates").find({}).toArray(),
      db.collection("stateResourceCapacity").find({}).toArray(),
      db
        .collection("extractionContracts")
        .find({ revokedTurn: { $exists: false } })
        .toArray(),
    ]);

  const globalSupply: number = (priceDoc as { globalSupply?: number } | null)?.globalSupply ?? 0;

  const fxByCurrency = new Map<CurrencyCode, number>(
    exchangeRates.map((r: Record<string, unknown>) => [
      r.currencyCode as CurrencyCode,
      r.rate as number,
    ])
  );
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1.0);

  const fxByCorpId = new Map<string, { code: CurrencyCode; rate: number }>();
  for (const c of allCorps as Array<Record<string, unknown>>) {
    const code = resolveCorpCurrency(c as { liquidCurrencyCode?: string; countryId?: string });
    fxByCorpId.set((c._id as ObjectId).toString(), {
      code,
      rate: fxByCurrency.get(code) ?? 1,
    });
  }

  const corpMap = new Map(allCorps.map((c) => [(c._id as ObjectId).toString(), c]));
  const natcorpIds = new Set(
    allCorps
      .filter((c: Record<string, unknown>) => !!c.countryOwnerId)
      .map((c) => (c._id as ObjectId).toString())
  );

  // Build extraction multipliers (mirror new route logic)
  const extractionSectors = allSectors.filter(
    (s: Record<string, unknown>) => s.sectorType === "extraction"
  );
  const extractableList: ExtractableResource[] = [
    "oil",
    "coal",
    "iron",
    "natural_gas",
    "timber",
    "rare_earth",
  ];

  const extractionInputs: ExtractionSectorInput[] = extractionSectors.map(
    (sector: Record<string, unknown>) => {
      const fx = fxByCorpId.get((sector.corporationId as ObjectId).toString());
      const sectorRevenueAnchor = readCorpEconomicAnchor(
        sector.revenue as number,
        fx?.code,
        fx?.rate ?? 1
      );
      const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
      const strategyRates =
        hasStrategy || sector.transitionFromStrategyId
          ? getEffectiveStrategyRates(
              "extraction",
              (sector.strategyId as string) ?? "standard",
              sector.transitionFromStrategyId as string | null | undefined,
              sector.transitionStartTurn as number | null | undefined,
              currentTurn
            )
          : null;

      const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
      for (const resource of extractableList) {
        const rate = strategyRates
          ? (strategyRates.supply[resource] ?? 0)
          : ((SECTOR_SUPPLY["extraction"] ?? []).find((f) => f.commodity === resource)?.rate ?? 0);
        if (rate > 0) {
          revenueBasedOutput[resource] =
            (sectorRevenueAnchor * rate) / COMMODITY_BASE_PRICES[resource];
        }
      }
      return {
        sectorId: (sector._id as ObjectId).toString(),
        stateId: sector.stateId as string,
        corporationId: sector.corporationId as ObjectId,
        revenueBasedOutput,
      };
    }
  );

  const extractionMultipliers = computeExtractionCapacityMultipliers(
    extractionInputs,
    contractDocs as never,
    capacityDocs as never
  );

  const basePrice = COMMODITY_BASE_PRICES[COMMODITY];

  function getEffectiveRate(sector: Record<string, unknown>): number {
    const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
    if (hasStrategy || sector.transitionFromStrategyId) {
      const sr = getEffectiveStrategyRates(
        sector.sectorType as never,
        (sector.strategyId as string) ?? "standard",
        sector.transitionFromStrategyId as string | null | undefined,
        sector.transitionStartTurn as number | null | undefined,
        currentTurn
      );
      return sr?.supply[COMMODITY] ?? 0;
    }
    const flows = SECTOR_SUPPLY[sector.sectorType as keyof typeof SECTOR_SUPPLY] ?? [];
    return flows.find((f) => f.commodity === COMMODITY)?.rate ?? 0;
  }

  const corpSupplyOld = new Map<string, number>();
  const corpSupplyNew = new Map<string, number>();

  const sectorsByCorp = new Map<string, Array<Record<string, unknown>>>();
  for (const s of allSectors as Array<Record<string, unknown>>) {
    const k = (s.corporationId as ObjectId).toString();
    const arr = sectorsByCorp.get(k) ?? [];
    arr.push(s);
    sectorsByCorp.set(k, arr);
  }

  for (const [corpId, sectors] of sectorsByCorp) {
    let oldUnits = 0;
    let newUnits = 0;
    const fx = fxByCorpId.get(corpId);
    const natcorpScale = natcorpIds.has(corpId) ? NATCORP_COMMODITY_MULTIPLIER : 1;
    for (const sector of sectors) {
      const rate = getEffectiveRate(sector);
      if (rate <= 0) continue;
      const revAnchor = readCorpEconomicAnchor(sector.revenue as number, fx?.code, fx?.rate ?? 1);
      const outMult = getOutputMultiplier((sector.productionPolicyLevel as number) ?? 0);
      oldUnits += dollarsToUnits(revAnchor * rate, basePrice) * outMult;
      let nu = dollarsToUnits(revAnchor * rate, basePrice) * outMult * natcorpScale;
      if (sector.sectorType === "extraction") {
        const m = extractionMultipliers.get((sector._id as ObjectId).toString())?.[COMMODITY] ?? 1;
        nu *= m;
      }
      newUnits += nu;
    }
    if (oldUnits > 0) corpSupplyOld.set(corpId, oldUnits);
    if (newUnits > 0) corpSupplyNew.set(corpId, newUnits);
  }

  const sortedOld = [...corpSupplyOld.entries()].sort((a, b) => b[1] - a[1]);
  const sortedNew = [...corpSupplyNew.entries()].sort((a, b) => b[1] - a[1]);
  const sumOld = sortedOld.reduce((s, [, v]) => s + v, 0);
  const sumNew = sortedNew.reduce((s, [, v]) => s + v, 0);

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  console.log(`\n=== Iron supply verification (turn ${currentTurn}) ===`);
  console.log(`DB headline globalSupply: ${fmt(globalSupply)} tons`);
  console.log(`(stored in commodityPrices.iron by commodityPriceTurn.ts)\n`);

  console.log("─── BEFORE FIX (current production code) ───");
  console.log(`Top 5 producers:`);
  for (const [cid, units] of sortedOld.slice(0, 5)) {
    const corp = corpMap.get(cid) as Record<string, unknown> | undefined;
    const tag = corp?.countryOwnerId ? "  [NATCORP]" : "";
    console.log(`  ${(corp?.name as string) ?? cid}: ${fmt(units)} tons${tag}`);
  }
  console.log(`Sum of all producers: ${fmt(sumOld)} tons`);
  console.log(
    `Top producer / globalSupply: ${((sortedOld[0]?.[1] ?? 0) / Math.max(1, globalSupply)).toFixed(2)}x`
  );

  console.log("\n─── AFTER FIX (with natcorp scale + extraction cap) ───");
  console.log(`Top 5 producers:`);
  for (const [cid, units] of sortedNew.slice(0, 5)) {
    const corp = corpMap.get(cid) as Record<string, unknown> | undefined;
    const tag = corp?.countryOwnerId ? "  [NATCORP]" : "";
    console.log(`  ${(corp?.name as string) ?? cid}: ${fmt(units)} tons${tag}`);
  }
  console.log(`Sum of all producers: ${fmt(sumNew)} tons`);
  console.log(
    `Top producer / globalSupply: ${((sortedNew[0]?.[1] ?? 0) / Math.max(1, globalSupply)).toFixed(2)}x`
  );
  console.log(
    `Sum + BASE (1000) vs globalSupply: ${fmt(sumNew + 1000)} vs ${fmt(globalSupply)}  → ratio ${(
      (sumNew + 1000) /
      Math.max(1, globalSupply)
    ).toFixed(3)}`
  );

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
