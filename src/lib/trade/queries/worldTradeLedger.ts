import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COMMODITY_LABELS, COMMODITY_ICONS, type CommodityType } from "@/lib/constants/commodities";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";

export interface LedgerNation {
  code: CountryId;
  name: string;
  hue: string;
  exports: number;
  imports: number;
  net: number;
  totalVolume: number;
  direction: "surplus" | "deficit" | "balanced";
}

export interface LedgerCommodity {
  key: CommodityType;
  label: string;
  icon: string;
  worldVolume: number;
  topExporter: { code: CountryId; net: number } | null;
  topImporter: { code: CountryId; net: number } | null;
}

export interface WorldTradeLedger {
  turn: number;
  updatedAt: string;
  headline: {
    worldVolume: number;
    largestSurplus: { code: CountryId; value: number } | null;
    largestDeficit: { code: CountryId; value: number } | null;
    surplusCount: number;
    deficitCount: number;
    mostTradedGood: { key: CommodityType; label: string; volume: number };
    verdict: "BALANCED" | "IMBALANCED";
    verdictRatio: number;
  };
  nations: LedgerNation[];
  commodities: LedgerCommodity[];
  /** Signed net matrix: bilateral[a][b] = a's net balance vs b (₳). */
  bilateral: Record<string, Record<string, number>>;
  /** Raw per-commodity flow matrices (₳) for the bilateral commodity breakdown. */
  flows: Partial<Record<CommodityType, Record<string, Record<string, number>>>>;
  meta: {
    countries: Array<{ code: CountryId; name: string; hue: string }>;
  };
}

const VERDICT_THRESHOLD = 0.12;

/**
 * Shape a stored trade-flow snapshot (₳) into the view-ready ledger payload.
 * Pure: no DB. Monetary values stay in ₳ — the client formats per viewer.
 */
export function shapeWorldTradeLedger(
  snap: Omit<TradeFlowSnapshot, "_id">,
  countries: CountryId[]
): WorldTradeLedger {
  const hueOf = (c: CountryId) => getStatsIdentity(c).accent.stat;

  // Bilateral net matrix from per-commodity flows.
  const bilateral: Record<string, Record<string, number>> = {};
  for (const a of countries) {
    bilateral[a] = {};
    for (const b of countries) bilateral[a][b] = 0;
  }
  const flows: WorldTradeLedger["flows"] = {};
  for (const [commodity, cf] of Object.entries(snap.commodities) as Array<
    [CommodityType, NonNullable<TradeFlowSnapshot["commodities"][CommodityType]>]
  >) {
    flows[commodity] = cf.flow;
    for (const e of countries) {
      const row = cf.flow[e] ?? {};
      for (const i of countries) {
        const v = row[i] ?? 0;
        if (v === 0) continue;
        bilateral[e][i] += v;
        bilateral[i][e] -= v;
      }
    }
  }

  const nations: LedgerNation[] = countries
    .map((c) => {
      const n = snap.national[c];
      const exports = n?.exports ?? 0;
      const imports = n?.imports ?? 0;
      const net = n?.net ?? 0;
      return {
        code: c,
        name: COUNTRY_CONFIGS[c]?.name ?? c,
        hue: hueOf(c),
        exports,
        imports,
        net,
        totalVolume: exports + imports,
        direction: net > 0 ? "surplus" : net < 0 ? "deficit" : "balanced",
      } as LedgerNation;
    })
    .sort((a, b) => b.net - a.net);

  const commodities: LedgerCommodity[] = (
    Object.entries(snap.commodities) as Array<
      [CommodityType, NonNullable<TradeFlowSnapshot["commodities"][CommodityType]>]
    >
  )
    .map(([key, cf]) => {
      let topExporter: { code: CountryId; net: number } | null = null;
      let topImporter: { code: CountryId; net: number } | null = null;
      for (const c of countries) {
        const net = cf.perCountry[c]?.net ?? 0;
        if (net > 0 && (!topExporter || net > topExporter.net)) topExporter = { code: c, net };
        if (net < 0 && (!topImporter || net < topImporter.net)) topImporter = { code: c, net };
      }
      return {
        key,
        label: COMMODITY_LABELS[key],
        icon: COMMODITY_ICONS[key],
        worldVolume: cf.worldVolume,
        topExporter,
        topImporter,
      };
    })
    .sort((a, b) => b.worldVolume - a.worldVolume);

  const worldVolume = snap.world.clearedVolume;
  const surplusNations = nations.filter((n) => n.net > 0);
  const deficitNations = nations.filter((n) => n.net < 0);
  const totalSurplus = surplusNations.reduce((s, n) => s + n.net, 0);
  const largest = nations[0];
  const smallest = nations[nations.length - 1];
  const mostTraded = commodities[0];
  const verdictRatio = worldVolume > 0 ? totalSurplus / worldVolume : 0;

  return {
    turn: snap.turn,
    updatedAt:
      snap.updatedAt instanceof Date ? snap.updatedAt.toISOString() : String(snap.updatedAt),
    headline: {
      worldVolume,
      largestSurplus:
        largest && largest.net > 0 ? { code: largest.code, value: largest.net } : null,
      largestDeficit:
        smallest && smallest.net < 0 ? { code: smallest.code, value: smallest.net } : null,
      surplusCount: surplusNations.length,
      deficitCount: deficitNations.length,
      mostTradedGood: mostTraded
        ? { key: mostTraded.key, label: mostTraded.label, volume: mostTraded.worldVolume }
        : { key: "steel", label: COMMODITY_LABELS.steel, volume: 0 },
      verdict: verdictRatio > VERDICT_THRESHOLD ? "IMBALANCED" : "BALANCED",
      verdictRatio,
    },
    nations,
    commodities,
    bilateral,
    flows,
    meta: {
      countries: countries.map((c) => ({
        code: c,
        name: COUNTRY_CONFIGS[c]?.name ?? c,
        hue: hueOf(c),
      })),
    },
  };
}
