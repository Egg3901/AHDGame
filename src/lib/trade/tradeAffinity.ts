import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import { isFtaActive, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";
import { computeAffinity } from "./affinity";
import { importerTariffOnFlow } from "./tariffDrag";
import { blockadeAffinityMultiplier } from "@/lib/navair/blockade";
import { PRIMARY_SECTOR_BY_COMMODITY } from "./commoditySector";

export interface TradeAffinityContext {
  /** Active FTA country pairs. */
  ftaPairs: FtaPairSet;
  /** Country → set of org ids it belongs to (shared org = bloc affinity). */
  blocsByCountry: ReadonlyMap<string, ReadonlySet<string>>;
  /** All tariffs (filtered per importer inside). */
  tariffs: readonly Tariff[];
  /** Active trade embargoes. */
  embargoes: readonly TradeEmbargo[];
  /**
   * Iron curtain: countries whose trade with the OUTSIDE world is closed —
   * the planned-economy set (`isPlannedEconomy` over MARKETIZATION_SCHEDULE),
   * resolved by the caller which owns year and flag context. Affinity between
   * a curtained and a non-curtained country is 0 in both directions; trade
   * WITHIN the curtain (Comecon) and within the open world is unaffected.
   * Absent/empty = no curtain (pre-flag worlds, tests).
   *
   * This closes TRADE, deliberately not corporate presence: a comprehensive
   * embargo would also suspend cross-curtain player sectors (buildLookups
   * corporateEmbargoSuppression), and East Germany is playable. Until real
   * east-west trade mechanics exist the curtain is absolute (observed before
   * it: Poland exported 2.66M units of food into Western imports with zero
   * embargoes in force, while Ukraine's 6.32M-unit surplus sat untraded).
   */
  curtainedCountries?: ReadonlySet<string>;
  /**
   * Naval blockade closure per country, 0..1, from the naval and air layer.
   *
   * Distinct from `embargoes` on purpose. An embargo is a political decision not to
   * trade; a blockade is hulls in the water stopping trade both parties still want. They
   * converge on the same effect here, but the causes stay separate so the trade layer can
   * still say WHY a lane closed. Absent means nobody is blockading anybody, which is the
   * common case and costs nothing.
   */
  blockadeClosure?: ReadonlyMap<string, number>;
}

export interface TradeAffinityFns {
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
  capUnitsFor: (
    commodity: CommodityType,
    exporter: CountryId,
    importer: CountryId
  ) => number | undefined;
}

/**
 * Directed flow key — "who imposes it on whom". An embargo's `direction` is
 * relative to `sourceCountry`, so both sides of the predicate collapse to a
 * lookup on one of these keys. See `indexEmbargoes`.
 */
function flowKey(source: string, target: string): string {
  return `${source}|${target}`;
}

type CommoditySet = Set<string>;
type CapByCommodity = Map<string, number>;

interface EmbargoIndex {
  /** source|target → commodities blocked flowing source→target. */
  blockExport: Map<string, CommoditySet>;
  /** source|target → commodities blocked flowing target→source. */
  blockImport: Map<string, CommoditySet>;
  /** source|target → smallest cap per commodity, per direction. */
  capExport: Map<string, CapByCommodity>;
  capImport: Map<string, CapByCommodity>;
}

/**
 * Resolve the embargo list once into directed `source|target` lookups.
 *
 * The clearing engine asks `affinityFor`/`capUnitsFor` once per
 * (commodity, exporter, importer) triple, and the active embargo list runs to
 * thousands of documents, so the old shape — a `some`/`for` over the whole
 * list on every call — was the phase's hot spot. `direction: "both"`
 * restricts both ways and so lands in both indexes. A `cap` embargo with no
 * numeric cap restricts nothing, and is dropped here exactly as the old
 * per-flow loop's `continue` did.
 */
function indexEmbargoes(embargoes: readonly TradeEmbargo[]): EmbargoIndex {
  const index: EmbargoIndex = {
    blockExport: new Map(),
    blockImport: new Map(),
    capExport: new Map(),
    capImport: new Map(),
  };

  const addBlock = (map: Map<string, CommoditySet>, key: string, commodity: string): void => {
    const set = map.get(key);
    if (set) set.add(commodity);
    else map.set(key, new Set([commodity]));
  };
  const addCap = (
    map: Map<string, CapByCommodity>,
    key: string,
    commodity: string,
    cap: number
  ): void => {
    const byCommodity = map.get(key);
    if (!byCommodity) {
      map.set(key, new Map([[commodity, cap]]));
      return;
    }
    const existing = byCommodity.get(commodity);
    if (existing === undefined || cap < existing) byCommodity.set(commodity, cap);
  };

  for (const em of embargoes) {
    if (!em.sourceCountry || !em.targetCountry) continue;
    const key = flowKey(em.sourceCountry, em.targetCountry);
    const exportSide = em.direction !== "import";
    const importSide = em.direction !== "export";
    if (em.mode === "block") {
      if (exportSide) addBlock(index.blockExport, key, em.commodity);
      if (importSide) addBlock(index.blockImport, key, em.commodity);
    } else if (em.cap !== undefined) {
      if (exportSide) addCap(index.capExport, key, em.commodity, em.cap);
      if (importSide) addCap(index.capImport, key, em.commodity, em.cap);
    }
  }
  return index;
}

/** Is `commodity` in a blocked set, either by name or by an "all" entry? */
function commodityBlocked(set: CommoditySet | undefined, commodity: CommodityType): boolean {
  if (!set) return false;
  return set.has(commodity) || set.has("all");
}

/** Smallest cap applying to `commodity` on one directed flow, if any. */
function capFor(
  map: Map<string, CapByCommodity>,
  key: string,
  commodity: CommodityType
): number | undefined {
  const byCommodity = map.get(key);
  if (!byCommodity) return undefined;
  const exact = byCommodity.get(commodity);
  const all = byCommodity.get("all");
  if (exact === undefined) return all;
  if (all === undefined) return exact;
  return Math.min(exact, all);
}

/**
 * Build the affinity + cap functions the clearing engine consumes, composing
 * the policy levers: base geography × FTA coverage × shared org bloc × importer
 * tariff drag, with embargoes blocking (mode "block" → affinity 0) or capping
 * (mode "cap" → capUnits) specific flows. Pure given its context.
 */
export function buildTradeAffinity(ctx: TradeAffinityContext): TradeAffinityFns {
  const { ftaPairs, blocsByCountry, tariffs, embargoes, curtainedCountries, blockadeClosure } = ctx;

  const curtained = (a: string, b: string): boolean => {
    if (!curtainedCountries || curtainedCountries.size === 0) return false;
    return curtainedCountries.has(a) !== curtainedCountries.has(b);
  };

  const sharesBloc = (a: string, b: string): boolean => {
    const ba = blocsByCountry.get(a);
    const bb = blocsByCountry.get(b);
    if (!ba || !bb || ba.size === 0 || bb.size === 0) return false;
    for (const org of ba) if (bb.has(org)) return true;
    return false;
  };

  const embargoIndex = indexEmbargoes(embargoes);

  return {
    affinityFor: (commodity, exporter, importer) => {
      if (curtained(exporter, importer)) return 0;
      // Export side: this pair's own `source|target` entry. Import side: the
      // same pair read the other way, because an "import" embargo names the
      // imposing country as source too.
      const blocked =
        commodityBlocked(embargoIndex.blockExport.get(flowKey(exporter, importer)), commodity) ||
        commodityBlocked(embargoIndex.blockImport.get(flowKey(importer, exporter)), commodity);
      if (blocked) return 0;

      // A blockade on EITHER end closes the flow: goods have to leave one coast and
      // arrive at another, and shutting either does it. Take the heavier of the two.
      const closure = Math.max(
        blockadeClosure?.get(exporter) ?? 0,
        blockadeClosure?.get(importer) ?? 0
      );
      if (closure >= 1) return 0;
      const sectorType = PRIMARY_SECTOR_BY_COMMODITY[commodity];
      const importerTariffRate = sectorType
        ? importerTariffOnFlow(tariffs, ftaPairs, importer, exporter, sectorType)
        : 0;
      const affinity = computeAffinity({
        exporter,
        importer,
        commodity,
        ftaCovered: isFtaActive(ftaPairs, exporter, importer),
        sharedBloc: sharesBloc(exporter, importer),
        importerTariffRate,
        blocked: false,
      });
      return closure > 0 ? affinity * blockadeAffinityMultiplier(closure) : affinity;
    },
    capUnitsFor: (commodity, exporter, importer) => {
      const exportCap = capFor(embargoIndex.capExport, flowKey(exporter, importer), commodity);
      const importCap = capFor(embargoIndex.capImport, flowKey(importer, exporter), commodity);
      if (exportCap === undefined) return importCap;
      if (importCap === undefined) return exportCap;
      return Math.min(exportCap, importCap);
    },
  };
}
