import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Tariff } from "@/lib/db/types/tariff";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import { isFtaActive, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";
import { computeAffinity } from "./affinity";
import { importerTariffOnFlow } from "./tariffDrag";
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
   * Iron curtain: countries whose trade with the OUTSIDE world is closed.
   * This is the planned-economy set minus curtain-specific exemptions,
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
}

export interface TradeAffinityFns {
  affinityFor: (commodity: CommodityType, exporter: CountryId, importer: CountryId) => number;
  capUnitsFor: (
    commodity: CommodityType,
    exporter: CountryId,
    importer: CountryId
  ) => number | undefined;
}

/** Does an embargo restrict the directed flow exporter→importer for `commodity`? */
function embargoMatches(
  em: TradeEmbargo,
  exporter: string,
  importer: string,
  commodity: CommodityType
): boolean {
  if (em.commodity !== "all" && em.commodity !== commodity) return false;
  // source imposes on target. "export": source won't export to target (flow source→target).
  // "import": source won't import from target (flow target→source). "both": either.
  const exportSide =
    (em.direction === "export" || em.direction === "both") &&
    em.sourceCountry === exporter &&
    em.targetCountry === importer;
  const importSide =
    (em.direction === "import" || em.direction === "both") &&
    em.sourceCountry === importer &&
    em.targetCountry === exporter;
  return exportSide || importSide;
}

/**
 * Build the affinity + cap functions the clearing engine consumes, composing
 * the policy levers: base geography × FTA coverage × shared org bloc × importer
 * tariff drag, with embargoes blocking (mode "block" → affinity 0) or capping
 * (mode "cap" → capUnits) specific flows. Pure given its context.
 */
export function buildTradeAffinity(ctx: TradeAffinityContext): TradeAffinityFns {
  const { ftaPairs, blocsByCountry, tariffs, embargoes, curtainedCountries } = ctx;

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

  const blocking = embargoes.filter((e) => e.mode === "block");
  const capping = embargoes.filter((e) => e.mode === "cap");

  return {
    affinityFor: (commodity, exporter, importer) => {
      if (curtained(exporter, importer)) return 0;
      const blocked = blocking.some((em) => embargoMatches(em, exporter, importer, commodity));
      if (blocked) return 0;
      const sectorType = PRIMARY_SECTOR_BY_COMMODITY[commodity];
      const importerTariffRate = sectorType
        ? importerTariffOnFlow(tariffs, ftaPairs, importer, exporter, sectorType)
        : 0;
      return computeAffinity({
        exporter,
        importer,
        commodity,
        ftaCovered: isFtaActive(ftaPairs, exporter, importer),
        sharedBloc: sharesBloc(exporter, importer),
        importerTariffRate,
        blocked: false,
      });
    },
    capUnitsFor: (commodity, exporter, importer) => {
      let cap: number | undefined;
      for (const em of capping) {
        if (em.cap === undefined) continue;
        if (!embargoMatches(em, exporter, importer, commodity)) continue;
        cap = cap === undefined ? em.cap : Math.min(cap, em.cap);
      }
      return cap;
    },
  };
}
