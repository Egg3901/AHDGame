/**
 * Era-aware readiness expectations.
 *
 * `COUNTRY_READINESS_EXPECTATIONS` is authored per country and read per world,
 * which makes it the sixth authority to answer "what should this country look
 * like?" without knowing which era it is being asked about. Russia's entry says
 * `partyRoster: "CPSU"`; applied to a 2019 world it let a Russian Federation
 * pass `partiesAuthored` by asserting a party whose seeds are gated to 1953 and
 * 1979.
 *
 * Five fields have a genuine per-era source and are derived from it. The rest
 * stay authored, because they are not counts: `seatMin` is a deliberate floor
 * ("RU has no static seedSeats section, so a fresh world legitimately starts at
 * 0"), and deriving it would replace documented judgment with arithmetic.
 * `HistoricalSeat` has no `countryId` either, so there is nothing to filter by.
 *
 * Every derived field falls back to the authored value when no era source
 * exists, so a country outside `FULL_ERA_REGION_BUNDLES` keeps exactly the
 * numbers it has today.
 *
 * Lives beside `countryReadinessExpectations.ts` rather than inside it, and
 * reads `expectedRegionCount` from `seedDiagnostic/regionBundles` rather than
 * from `seedDiagnostic/expectations`. Both avoid the same cycle: the readiness
 * contract imports this module, and `seedDiagnostic/expectations` reaches
 * `seedCountryGameStates`, which imports the readiness contract straight back.
 * `regionBundles` depends on neither side.
 */
import type { CountryId } from "@/lib/constants/countries";
import {
  COUNTRY_READINESS_EXPECTATIONS,
  type CountryReadinessExpectations,
} from "@/lib/constants/countryReadinessExpectations";
import { expectedRegionCount } from "@/lib/admin/seedDiagnostic/regionBundles";
import { partyRosterLabel, partySeedsForPreset } from "@/lib/seeds/partySeedRegistry";

/**
 * What this country should look like in this preset, or null when no entry is
 * authored for it at all.
 */
export function getReadinessExpectations(
  countryId: CountryId,
  preset: string
): CountryReadinessExpectations | null {
  const authored = COUNTRY_READINESS_EXPECTATIONS[countryId];
  if (!authored) return null;

  // null when the country has no era-authored region bundle: keep the number the
  // entry already carries rather than collapsing the expectation to zero.
  const regions = expectedRegionCount(countryId, preset);
  const parties = partySeedsForPreset(countryId, preset);

  return {
    ...authored,
    regionCount: regions ?? authored.regionCount,
    // Both track the region count, and both are era-varying for the same reason.
    // Where an entry deliberately differs (RU: 17 regions but 14 demographic
    // rows, the Soviet republics being checked under their own entries), the
    // difference is carried through as an offset rather than flattened.
    demographicsCount:
      regions === null
        ? authored.demographicsCount
        : regions - (authored.regionCount - authored.demographicsCount),
    stateMetricsCount:
      regions === null
        ? authored.stateMetricsCount
        : regions - (authored.regionCount - authored.stateMetricsCount),
    // `Math.min` keeps the authored floor as a ceiling on itself: when an era
    // seeds fewer parties than the entry demands, the expectation drops to what
    // the era actually seeds, and it never invents a stricter requirement than
    // the author wrote. An era that seeds none expects none.
    partyMin: Math.min(authored.partyMin, parties.length),
    partyRoster: partyRosterLabel(parties),
  };
}
