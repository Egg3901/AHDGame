import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { Tariff } from "@/lib/db/types/tariff";
import { isFtaActive, type FtaPairSet } from "@/lib/tariffs/ftaOverrides";

/**
 * Effective import tariff (as a fraction, 0..1) the importer levies on a flow
 * of a given sector type from a given exporter. Economy-wide tariffs always
 * apply; sector tariffs apply to their sector; origin-country tariffs apply only
 * to their target exporter. An active FTA between the pair neutralises the whole
 * drag (mirrors how the tariff system already exempts FTA-covered trade).
 * Corporation-scoped tariffs are ignored (not a country-flow concept). Pure.
 */
export function importerTariffOnFlow(
  tariffs: readonly Tariff[],
  ftaPairs: FtaPairSet,
  importer: CountryId,
  exporter: CountryId,
  sectorType: CorporationType
): number {
  if (isFtaActive(ftaPairs, importer, exporter)) return 0;
  let totalPct = 0;
  for (const t of tariffs) {
    if (t.countryId !== importer) continue;
    if (t.scopeType === "economy_wide") {
      totalPct += t.rate;
    } else if (t.scopeType === "sector" && t.targetSectorType === sectorType) {
      totalPct += t.rate;
    } else if (t.scopeType === "origin_country" && t.targetOriginCountryId === exporter) {
      totalPct += t.rate;
    }
  }
  if (!Number.isFinite(totalPct) || totalPct <= 0) return 0;
  return Math.min(1, totalPct / 100);
}
