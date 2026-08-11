// src/lib/seats/seatId.ts
import type { CountryId } from "@/lib/constants/countries";

/**
 * Get the local region ID. Post-migration, region IDs are already unprefixed
 * (e.g., "LON", "SCO", "ON"). This function is now a passthrough but kept
 * for call-site compatibility.
 */
export function getLocalRegionId(state: string, _countryId: CountryId): string {
  return state;
}

/**
 * Build a seatId from components.
 * Format: {countryId}-{electionType}[-{localRegionId}][-{chamberClass}]
 *
 * The fourth segment is a class number used by chambers that hold staggered
 * elections — US Senate (classes 1-3) and JP Sangiin (classes 1-2). It must
 * be present whenever the chamber distinguishes classes; otherwise multiple
 * elections collapse onto the same seatId and routing breaks.
 *
 * Examples:
 * - US-senate-PA-1
 * - US-house-CA
 * - US-president
 * - UK-commons-LON
 * - JP-sangiin-TOH-1
 */
export function buildSeatId(
  countryId: CountryId,
  electionType: string,
  state: string,
  chamberClass?: 1 | 2 | 3
): string {
  // President is national, no region component
  if (electionType === "president") {
    return `${countryId}-president`;
  }

  const localRegion = getLocalRegionId(state, countryId);
  const parts = [countryId, electionType, localRegion];

  if (chamberClass !== undefined) {
    parts.push(String(chamberClass));
  }

  return parts.join("-");
}

/**
 * Parse a seatId back into components.
 *
 * For class-staggered chambers (US Senate, JP Sangiin) the trailing numeric
 * segment is exposed via both `senateClass` (US-style 1-3) and `chamberClass`
 * (JP-style 1-2) so callers can pull whichever field matches their domain.
 */
export function parseSeatId(seatId: string): {
  countryId: CountryId;
  electionType: string;
  localRegionId: string | undefined;
  senateClass: 1 | 2 | 3 | undefined;
  chamberClass: 1 | 2 | 3 | undefined;
} {
  const parts = seatId.split("-");
  const countryId = parts[0] as CountryId;
  const electionType = parts[1];

  // President has no region
  if (electionType === "president") {
    return {
      countryId,
      electionType,
      localRegionId: undefined,
      senateClass: undefined,
      chamberClass: undefined,
    };
  }

  const localRegionId = parts[2];
  const classNum = parts[3] ? (parseInt(parts[3], 10) as 1 | 2 | 3) : undefined;

  return {
    countryId,
    electionType,
    localRegionId,
    senateClass: electionType === "senate" ? classNum : undefined,
    chamberClass: classNum,
  };
}

/**
 * Get a historical race ID by appending the cycle number.
 * Used for referencing specific election instances.
 */
export function getHistoricalRaceId(seatId: string, cycle: number): string {
  return `${seatId}-c${cycle}`;
}

/**
 * Build a seatId from an Election (or Seat) document.
 *
 * Accepts either `senateClass` (US Senate) or `chamberClass` (JP Sangiin) —
 * whichever the source document carries. If both are present, `senateClass`
 * wins (Senate elections never set `chamberClass`).
 */
export function getSeatIdFromElection(election: {
  countryId?: CountryId;
  electionType: string;
  state: string;
  senateClass?: 1 | 2 | 3;
  chamberClass?: 1 | 2;
}): string {
  return buildSeatId(
    election.countryId ?? "US",
    election.electionType,
    election.state,
    election.senateClass ?? election.chamberClass
  );
}
