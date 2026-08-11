/**
 * Voting-age eligibility threshold.
 *
 * An explicit per-world `gameState.votingAgeEligible` always wins — that is the
 * channel franchise legislation writes through. With no explicit value the
 * threshold comes from the YEAR: 21 before the 26th Amendment, 18 after.
 *
 * That fallback is the whole point of this function existing. Nothing in the
 * codebase has ever written `votingAgeEligible`, so it resolved to 18 in every
 * world — meaning a 1953 world enfranchised 18-to-20-year-olds eighteen years
 * before the Amendment did, inflating the electorate by roughly 6% and handing
 * it the era's most left-leaning cohort. A null year keeps the flat modern
 * default, so a world with no clock is unchanged.
 *
 * Clamped to a sane band so a malformed stored value can't empty or absurdly
 * inflate the electorate.
 */
export const DEFAULT_VOTING_AGE = 18;
/**
 * Pre-26th-Amendment threshold. Ratified 1 July 1971, so the 1972 cycle is the
 * first with an 18-year-old franchise. Georgia and Kentucky had already lowered
 * theirs (to 18 and 19) well before that, which this national constant does not
 * model — a per-state franchise would need its own table.
 */
export const PRE_26TH_AMENDMENT_VOTING_AGE = 21;
/** Year the 26th Amendment takes effect for eligibility purposes. */
export const VOTING_AGE_18_FROM_YEAR = 1971;

const MIN_VOTING_AGE = 16;
const MAX_VOTING_AGE = 25;

export function resolveVotingAgeEligible(
  source:
    | { votingAgeEligible?: number; votingAgeEligibleByCountry?: Partial<Record<string, number>> }
    | undefined,
  year?: number | null,
  /** Enacting country's franchise wins over the legacy global field. */
  countryId?: string
): number {
  const perCountry = countryId
    ? source?.votingAgeEligibleByCountry?.[countryId.toUpperCase()]
    : undefined;
  const v = perCountry ?? source?.votingAgeEligible;
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(MIN_VOTING_AGE, Math.min(MAX_VOTING_AGE, Math.round(v)));
  }
  if (typeof year === "number" && Number.isFinite(year) && year < VOTING_AGE_18_FROM_YEAR) {
    return PRE_26TH_AMENDMENT_VOTING_AGE;
  }
  return DEFAULT_VOTING_AGE;
}
