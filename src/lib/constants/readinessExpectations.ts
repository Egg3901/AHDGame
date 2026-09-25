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
import { checkGovernmentFormation } from "@/lib/constants/readinessChecks";

/**
 * Era overrides for `seatMin`, where a country's chambers are a different size
 * than the authored entry assumes.
 *
 * ⚠️ AN OVERRIDE TABLE RATHER THAN A DERIVATION, deliberately. The header above
 * explains why `seatMin` stays authored: it is a judgment about what a healthy
 * fresh world looks like, not a chamber-size sum, and RU's floor of 0 is the
 * case that makes arithmetic wrong. Overriding the two eras where the authored
 * number is measured against the wrong chamber keeps that judgment intact.
 *
 * ⚠️ THIS EXISTS BECAUSE THE DIAGNOSTIC COULD NOT SEE A 46-SEAT HOLE. Japan's
 * authored floor is 713 with the note "465 Shugiin + 248 Sangiin" — the modern
 * Diet. The 1991 Diet is 512 + 252 = 764, and a 1991 world seating 512 + 206
 * reported 718, cleared 713, and passed while a fifth of its upper house was
 * missing.
 *
 * Only Japan needs an entry. The US floor of 535 is right in both eras (435 +
 * 100 did not change), and the UK's 650 is right in both now that 1991 seats
 * the 1987 Commons rather than the 651-seat 1992 one.
 */
const SEAT_MIN_BY_PRESET: Partial<
  Record<string, Partial<Record<CountryId, { seatMin: number; seatNote: string }>>>
> = {
  "1991-default": {
    JP: {
      seatMin: 764,
      seatNote: "Expected ≥764 (512 Shugiin + 252 Sangiin, pre-1994 Diet)",
    },
  },
};

const INITIAL_READINESS_BY_PRESET: Partial<
  Record<string, Partial<Record<CountryId, Partial<CountryReadinessExpectations>>>>
> = {
  "1991-default": {
    RU: {
      // The leader-confidence document is part of the Soviet one-party
      // premier system. January 1991 Russia has a multiparty successor
      // roster; it still needs a formed government, but its missing Soviet
      // leader-confidence row is not a defect in that government.
      extras: [(db) => checkGovernmentFormation("RU", db)],
      // The 1991 bundle contains ten RSFSR economic regions. The authored
      // Soviet offset of three belongs only to the 1953/1979 union roster.
      demographicsCount: 10,
      stateMetricsCount: 10,
      // The 70-person floor describes the USSR's two-chamber delegation and
      // premier roster. January 1991 RSFSR uses a different Congress; no
      // founding NPP/official seeder currently populates those rows, as with
      // the other six 1991 successor countries. Count its organization and
      // government documents separately instead of testing Soviet offices.
      nppMin: 0,
      nppNote: "No Soviet delegation roster in the 1991 RSFSR seed",
      officialMin: 0,
    },
    DE: {
      // The reunified 1991 roster seeds 70 party footprints across 16 Länder:
      // CDU/CSU are geographically exclusive and PDS/Alliance 90 are not
      // represented in every Land. The 112-row floor describes a later roster.
      statePartyOrgMin: 70,
      // Founding NPPs are seated before later candidate generation. The
      // modern 217-person estimate counts offices, not distinct people.
      nppMin: 177,
      nppNote: "Expected ≥177 founding German NPPs before candidate generation",
    },
  },
  "2027-default": {
    DE: {
      // Six national party footprints plus Bavaria-only CSU: 15 CDU + 1 CSU
      // + five parties in all 16 Länder = 96 organizations.
      statePartyOrgMin: 96,
      // Fresh bootstrap seats multiple offices per NPP. Additional candidates
      // are generated during turns, so the old 217 unique-person floor was wrong.
      nppMin: 177,
      nppNote: "Expected ≥177 founding German NPPs before candidate generation",
    },
  },
};

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
  const seats = SEAT_MIN_BY_PRESET[preset]?.[countryId];
  const eraOverride = INITIAL_READINESS_BY_PRESET[preset]?.[countryId];

  return {
    ...authored,
    ...(eraOverride ?? {}),
    ...(seats ?? {}),
    regionCount: regions ?? authored.regionCount,
    // Both track the region count, and both are era-varying for the same reason.
    // Where an entry deliberately differs (RU: 17 regions but 14 demographic
    // rows, the Soviet republics being checked under their own entries), the
    // difference is carried through as an offset rather than flattened.
    demographicsCount:
      eraOverride?.demographicsCount ??
      (regions === null
        ? authored.demographicsCount
        : regions - (authored.regionCount - authored.demographicsCount)),
    stateMetricsCount:
      eraOverride?.stateMetricsCount ??
      (regions === null
        ? authored.stateMetricsCount
        : regions - (authored.regionCount - authored.stateMetricsCount)),
    // `Math.min` keeps the authored floor as a ceiling on itself: when an era
    // seeds fewer parties than the entry demands, the expectation drops to what
    // the era actually seeds, and it never invents a stricter requirement than
    // the author wrote. An era that seeds none expects none.
    partyMin: Math.min(authored.partyMin, parties.length),
    partyRoster: partyRosterLabel(parties),
  };
}
