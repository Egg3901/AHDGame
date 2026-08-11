/**
 * Country-aware regional-executive lookup.
 *
 * Resolves the current "executive modifier" presence for a state / region.
 * Used by `getStateOverview()` to populate the optional regional-executive
 * chip on the State Overview tab.
 *
 * Coverage (Phase 1 of UK + JP devolved-executive work, 2026-05-20):
 *   - US: elected `governor` per state → `"Governor"`
 *   - DE: elected `ministerPresident` per Land → `"Ministerpräsident"`
 *   - UK: elected `governor` per devolved region, label varies by region
 *       - SCO / WAL / NIR → `"First Minister"`
 *       - LON → `"Mayor of London"`
 *       - English regions other than LON → `null` (no devolved executive)
 *   - JP: elected `governor` per region → `"Governor"`
 *   - CN: elected `governor` per macro-region → `"Governor"`
 *   - IE: elected `governor` per region, label varies by region (recycled
 *     `governor` officeType for the Cathaoirleach):
 *       - DUB → `"Lord Mayor of Dublin"`
 *       - COR → `"Lord Mayor of Cork"`
 *       - LIM → `"Mayor of Limerick"`
 *       - GAL → `"Mayor of Galway"`
 *       - all other IE regions → `"Cathaoirleach"`
 *   - any other country: `null`
 *
 * See `docs/design/uk-jp-devolved-executives.md` for the design that
 * recycles the cross-country `governor` OfficeType for UK FMs / Mayor of
 * London and JP regional governors — same mechanical shape, different
 * display labels.
 */

import type { Db } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { loadTurnLengthMinutes } from "@/lib/financialTxLog/expiresAt";
import { regionalExecutiveSignForTenure } from "./regionalExecutiveConstants";

/** Magnitude band of the regional-executive modifier (low / medium / high). */
export type RegionalExecutiveSign = 1 | 2 | 3;

export interface RegionalExecutive {
  /** Party id of the seated executive. */
  partyId: string;
  /** Magnitude band derived from incumbent tenure (see regionalExecutiveConstants). */
  sign: RegionalExecutiveSign;
  /** Display label for the chip — `"Governor"`, `"First Minister"`, etc. */
  label: string;
}

/** UK regions whose devolved executive is a "First Minister". */
const UK_FIRST_MINISTER_REGIONS = new Set(["SCO", "WAL", "NIR"]);

/**
 * Resolve the `(officeType, label)` pair for the regional-executive lookup
 * given `(countryId, stateId)`. Returns null when no comparable office
 * exists for that region (e.g. English non-London UK regions).
 */
export function resolveExecutiveOffice(
  countryId: CountryId,
  stateId: string
): { officeType: string; label: string } | null {
  const upper = stateId.toUpperCase();
  switch (countryId) {
    case "US":
      return { officeType: "governor", label: "Governor" };
    case "DE":
      return { officeType: "ministerPresident", label: "Ministerpräsident" };
    case "JP":
      return { officeType: "governor", label: "Governor" };
    case "CN":
      return { officeType: "governor", label: "Governor" };
    case "UK":
      if (upper === "LON") return { officeType: "governor", label: "Mayor of London" };
      if (UK_FIRST_MINISTER_REGIONS.has(upper)) {
        return { officeType: "governor", label: "First Minister" };
      }
      // English non-London regions: no devolved executive.
      return null;
    case "IE":
      if (upper === "DUB") return { officeType: "governor", label: "Lord Mayor of Dublin" };
      if (upper === "COR") return { officeType: "governor", label: "Lord Mayor of Cork" };
      if (upper === "LIM") return { officeType: "governor", label: "Mayor of Limerick" };
      if (upper === "GAL") return { officeType: "governor", label: "Mayor of Galway" };
      // All other IE regions: Cathaoirleach.
      return { officeType: "governor", label: "Cathaoirleach" };
    default:
      return null;
  }
}

/**
 * Resolve the regional executive for `(countryId, stateId)`.
 *
 * Returns the seated executive's `{ partyId, sign, label }` when one
 * exists, or `null` when:
 *   - the region has no comparable executive office (English non-London
 *     UK regions, or any unsupported country)
 *   - the office is vacant (no `electedOfficials` row)
 *   - the seated official has no `party` value (data integrity edge case)
 */
export async function getRegionalExecutive(
  db: Db,
  countryId: CountryId,
  stateId: string,
  now: Date = new Date(),
  turnLengthMinutes?: number
): Promise<RegionalExecutive | null> {
  const config = resolveExecutiveOffice(countryId, stateId);
  if (!config) return null;

  // Sort by electedAt desc so we deterministically pick the most recent
  // record when (rare) data-integrity issues leave multiple matches.
  // Match `getRegionOfficials`'s pattern: ElectedOfficial.state is stored
  // upper-cased; uppercase the input defensively in case a caller passes
  // a lowercase region id.
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne(
    {
      countryId,
      state: stateId.toUpperCase(),
      officeType: config.officeType,
    },
    { sort: { electedAt: -1 } }
  );

  if (!official?.party) return null;

  // Magnitude band from tenure. Turn length is config-tunable, so convert the
  // elapsed wall-clock since election into turns. Missing `electedAt` (legacy
  // rows) → treat as freshly elected (Light).
  const minutesPerTurn = turnLengthMinutes ?? (await loadTurnLengthMinutes(db));
  const tenureTurns = official.electedAt
    ? Math.floor(
        (now.getTime() - new Date(official.electedAt).getTime()) / (minutesPerTurn * 60_000)
      )
    : 0;

  return {
    partyId: official.party,
    sign: regionalExecutiveSignForTenure(tenureTurns),
    label: config.label,
  };
}

/**
 * Pure variant of {@link getRegionalExecutive} that takes an already-fetched
 * ElectedOfficial instead of querying for it. Lets batch callers (e.g. the
 * per-turn regDriftDecay phase) load every region's executive official in one
 * query and compute the executive in memory, instead of one findOne per
 * region. Returns the same shape/semantics as getRegionalExecutive.
 */
export function regionalExecutiveFromOfficial(
  countryId: CountryId,
  stateId: string,
  official: Pick<ElectedOfficial, "party" | "electedAt"> | null | undefined,
  now: Date,
  minutesPerTurn: number
): RegionalExecutive | null {
  const config = resolveExecutiveOffice(countryId, stateId);
  if (!config) return null;
  if (!official?.party) return null;
  const tenureTurns = official.electedAt
    ? Math.floor(
        (now.getTime() - new Date(official.electedAt).getTime()) / (minutesPerTurn * 60_000)
      )
    : 0;
  return {
    partyId: official.party,
    sign: regionalExecutiveSignForTenure(tenureTurns),
    label: config.label,
  };
}
