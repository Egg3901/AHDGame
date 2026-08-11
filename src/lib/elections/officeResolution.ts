/**
 * Resolve an election to the office it fills.
 *
 * The elections list groups by office, which needs a reliable
 * `electionType -> office` mapping. There isn't a single one in the data:
 *
 *   - FR / IT / ES / TR seed `assembleeNationale`, `cameraDeputati`,
 *     `congresoDiputados`, `milletMeclisi` as the election type, while the
 *     office is keyed `deputy` / `senator`. Those match the CHAMBER key.
 *   - US / RU / DD / CN seed `senate`, `supremeSovietDeputy`,
 *     `volkskammerDeputy`, `npcDelegate`. Those match the OFFICE key.
 *
 * Measured against the live 1953 world: of 28 distinct
 * `(countryId, electionType)` pairs, 24 resolve on the office key and 4 need
 * the chamber-key fallback. None are unresolvable. `officeResolution.test.ts`
 * asserts that across every country so a new seed can't silently drop races
 * out of the list.
 */

import {
  COUNTRY_CONFIGS,
  type ChamberConfig,
  type CountryId,
  type OfficeTypeConfig,
} from "@/lib/constants/countries";

export interface ElectionOffice {
  /** Stable grouping + URL key. Always the `OfficeTypeConfig.key`. */
  key: string;
  /** Singular office label, e.g. "Senator". */
  label: string;
  /** Section heading, e.g. "Senate" or "Camera dei Deputati". */
  sectionLabel: string;
  /** Seats in the chamber this office sits in, when it sits in one. */
  chamberSeats: number | null;
  isExecutive: boolean;
  isSubNational: boolean;
  /** Display order: executive, then national chambers, then sub-national. */
  order: number;
}

/**
 * Snap elections reuse the ordinary chamber's office under a `snap_` prefix
 * (`snap_commons`, `snap_bundestag`, `snap_shugiin` — see `MULTI_SEAT_TYPES`).
 * They belong in the same section as the regular race for that chamber.
 */
const SNAP_PREFIX = "snap_";

function chambersOf(countryId: CountryId): ChamberConfig[] {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return [];
  return [
    config.legislature?.lowerChamber,
    config.legislature?.upperChamber,
    config.subNationalChamber,
  ].filter((c): c is ChamberConfig => !!c);
}

function orderOf(office: OfficeTypeConfig, chamber: ChamberConfig | null): number {
  if (office.isExecutive) return 0;
  if (office.isHeadOfState) return 1;
  if (office.isSubNational) return 4;
  // A national chamber: keep lower before upper by seat count as a proxy only
  // when we have a chamber; officeless roles sort after chambers.
  if (chamber) return 2;
  return 3;
}

/**
 * Every office in this country that an election can fill, in display order.
 *
 * Executive first, then national chambers, then sub-national bodies. Offices a
 * country does not define are simply absent, so nothing here needs a per-country
 * allowlist.
 */
export function listCountryOffices(countryId: CountryId): ElectionOffice[] {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return [];
  const chambers = chambersOf(countryId);

  return config.officeTypes
    .map((office, index) => {
      const chamber = office.chamberKey
        ? (chambers.find((c) => c.key === office.chamberKey) ?? null)
        : null;
      return {
        key: office.key,
        label: office.label,
        // A chamber name ("House of Representatives", "Camera dei Deputati") is
        // the clearest section heading. Offices with no chamber (Governor,
        // President) use their own plural.
        sectionLabel: chamber?.name ?? office.labelPlural,
        chamberSeats: chamber?.seats ?? null,
        isExecutive: office.isExecutive,
        isSubNational: office.isSubNational,
        order: orderOf(office, chamber) * 100 + index,
      };
    })
    .sort((a, b) => a.order - b.order);
}

/**
 * The office key an election of this type fills, or null when nothing matches.
 *
 * Callers must handle null by surfacing the race in a catch-all section rather
 * than dropping it — a race the player cannot see is worse than one filed under
 * the wrong heading.
 */
export function resolveOfficeKeyForElectionType(
  countryId: CountryId,
  electionType: string
): string | null {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) return null;

  const type = electionType.startsWith(SNAP_PREFIX)
    ? electionType.slice(SNAP_PREFIX.length)
    : electionType;

  const byOfficeKey = config.officeTypes.find((o) => o.key === type);
  if (byOfficeKey) return byOfficeKey.key;

  const byChamberKey = config.officeTypes.find((o) => o.chamberKey === type);
  if (byChamberKey) return byChamberKey.key;

  return null;
}

/**
 * The chamber an office sits in, for seat totals and composition panels.
 * Returns null for executive and other chamberless offices.
 */
export function resolveChamberForOffice(
  countryId: CountryId,
  officeKey: string
): ChamberConfig | null {
  const config = COUNTRY_CONFIGS[countryId];
  const office = config?.officeTypes.find((o) => o.key === officeKey);
  if (!office?.chamberKey) return null;
  return chambersOf(countryId).find((c) => c.key === office.chamberKey) ?? null;
}
