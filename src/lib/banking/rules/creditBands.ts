/**
 * Household credit bands and the CEO's lending profile.
 *
 * The NPC household book used to be one number: a single `npcBulk` loan with
 * one rate and one blended default rate. That is why the console could only
 * ever say "NPC bulk outstanding (implied): $16.64M" — there was nothing else
 * to say, because nothing else was stored.
 *
 * A real loan book is a distribution. Households differ in creditworthiness,
 * the bank charges each band a different rate, and each band defaults at a
 * different rate. Splitting the book into bands makes three things true that
 * were not true before:
 *
 *  - the console can show the book the way a banker would read it, by rating;
 *  - the CEO has a decision to make (which bands to lend into) rather than a
 *    single rate lever that moves volume and risk together;
 *  - the supervisory stress test can bite an aggressive book harder than a
 *    conservative one, because it now knows what the book is made of.
 *
 * ## Why aggressive is not simply better
 *
 * Aggressive lending buys volume at a worse margin. Reading the table below at
 * an 8% base lending rate: a conservative book nets ~6.8% on 45% of household
 * demand, an aggressive book nets ~6.2% on 100% of it. Aggressive earns more in
 * absolute terms in calm conditions, and that is the point — it should be a
 * live temptation, not a trap. What it buys with that is a book whose stress
 * loss is roughly 15% against a conservative book's 3%, and
 * {@link STRESS_LOSS_MULTIPLIER} turns that straight into a failed stress test
 * and barred distributions. The choice is margin and safety against volume and
 * fragility, which is the choice an actual bank makes.
 */

/** Rating bands, ordered best credit first. Display order in the console. */
export const CREDIT_BAND_IDS = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"] as const;

export type CreditBandId = (typeof CREDIT_BAND_IDS)[number];

export interface CreditBand {
  id: CreditBandId;
  /** Share of total household loan demand sitting in this band. Sums to 1. */
  demandShare: number;
  /** Premium over the bank's posted lending rate, in percentage points. */
  ratePremiumPp: number;
  /** Expected annual default rate on this band, percent of outstanding. */
  defaultRatePercent: number;
}

/**
 * Provisional - flagged for user review. Shares are skewed to the middle
 * because that is where households actually sit; the tails are thin so a bank
 * that opens the bottom two bands gains volume without the book becoming
 * mostly junk.
 */
export const CREDIT_BANDS: readonly CreditBand[] = [
  { id: "AAA", demandShare: 0.1, ratePremiumPp: -1.5, defaultRatePercent: 0.2 },
  { id: "AA", demandShare: 0.15, ratePremiumPp: -0.75, defaultRatePercent: 0.5 },
  { id: "A", demandShare: 0.2, ratePremiumPp: 0, defaultRatePercent: 1.0 },
  { id: "BBB", demandShare: 0.22, ratePremiumPp: 1.0, defaultRatePercent: 2.0 },
  { id: "BB", demandShare: 0.18, ratePremiumPp: 2.5, defaultRatePercent: 4.5 },
  { id: "B", demandShare: 0.1, ratePremiumPp: 4.5, defaultRatePercent: 8.0 },
  { id: "CCC", demandShare: 0.05, ratePremiumPp: 8.0, defaultRatePercent: 15.0 },
];

const BAND_BY_ID = new Map<CreditBandId, CreditBand>(CREDIT_BANDS.map((b) => [b.id, b]));

/**
 * Band a legacy single-lump `npcBulk` loan is reported under.
 *
 * Books originated before the split have one blended rate and no band. They are
 * shown as A rather than hidden or discarded: A is the reference band (zero rate
 * premium), so a legacy row keeps its own stored rate and reads as the neutral
 * middle of the book instead of flattering or damning it.
 */
export const LEGACY_BAND: CreditBandId = "A";

export function getCreditBand(id: CreditBandId | undefined): CreditBand {
  return BAND_BY_ID.get(id ?? LEGACY_BAND) ?? BAND_BY_ID.get(LEGACY_BAND)!;
}

// ── Lending profile ────────────────────────────────────────────────────

export const LENDING_PROFILE_IDS = ["conservative", "balanced", "aggressive"] as const;

export type LendingProfileId = (typeof LENDING_PROFILE_IDS)[number];

export interface LendingProfile {
  id: LendingProfileId;
  label: string;
  /** The lowest band this profile will originate into. */
  floorBand: CreditBandId;
  /** One line, shown under the selector. */
  blurb: string;
}

export const LENDING_PROFILES: readonly LendingProfile[] = [
  {
    id: "conservative",
    label: "Conservative",
    floorBand: "A",
    blurb:
      "Prime households only. The best margin on the smallest book, and a stress test you clear comfortably.",
  },
  {
    id: "balanced",
    label: "Balanced",
    floorBand: "BBB",
    blurb: "Prime and mid-grade. Two thirds of household demand at a margin close to conservative.",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    floorBand: "CCC",
    blurb:
      "Lend to everyone. The largest book and the most income, on a thinner margin and a book that fails the supervisory shock.",
  },
];

export const DEFAULT_LENDING_PROFILE: LendingProfileId = "balanced";

const PROFILE_BY_ID = new Map<LendingProfileId, LendingProfile>(
  LENDING_PROFILES.map((p) => [p.id, p])
);

export function getLendingProfile(id: LendingProfileId | undefined): LendingProfile {
  return (
    PROFILE_BY_ID.get(id ?? DEFAULT_LENDING_PROFILE) ?? PROFILE_BY_ID.get(DEFAULT_LENDING_PROFILE)!
  );
}

export function isLendingProfileId(value: unknown): value is LendingProfileId {
  return typeof value === "string" && (LENDING_PROFILE_IDS as readonly string[]).includes(value);
}

/** Bands a profile originates into, best credit first. */
export function bandsForProfile(profileId: LendingProfileId | undefined): CreditBand[] {
  const floor = getLendingProfile(profileId).floorBand;
  const floorIndex = CREDIT_BAND_IDS.indexOf(floor);
  return CREDIT_BANDS.filter((band) => CREDIT_BAND_IDS.indexOf(band.id) <= floorIndex);
}

/** Share of total household demand a profile is willing to serve, 0..1. */
export function demandShareForProfile(profileId: LendingProfileId | undefined): number {
  return bandsForProfile(profileId).reduce((sum, band) => sum + band.demandShare, 0);
}

/** Rate this bank charges a band, floored at zero. */
export function bandRatePercent(band: CreditBand, lendingRatePercent: number): number {
  const base = Number.isFinite(lendingRatePercent) ? lendingRatePercent : 0;
  return Math.max(0, base + band.ratePremiumPp);
}

// ── Supervisory stress ─────────────────────────────────────────────────

/**
 * How much worse than expected defaults get in the supervisory scenario.
 *
 * Chosen so that an aggressive book lands on ~15% stress loss, which is the
 * flat {@link STRESS_LOSS_FRACTION} the supervisor applied to every bank before
 * bands existed. Aggressive banks therefore see no change in how hard the shock
 * hits them; conservative banks are the ones that stop being punished for a
 * book they never held.
 */
export const STRESS_LOSS_MULTIPLIER = 5;

/** Flat fallback stress loss for a book with no band detail (legacy rows). */
export const STRESS_LOSS_FRACTION = 0.15;

export type BookTranche = { creditBand?: CreditBandId; outstanding: number };

/**
 * Share of a book that defaults at once in the supervisory scenario, from the
 * bands it is actually made of. Falls back to the flat fraction when the book
 * carries no band detail at all, so a legacy book is never scored as safer than
 * it is on the strength of missing data.
 */
export function stressLossFraction(tranches: readonly BookTranche[]): number {
  let total = 0;
  let weighted = 0;
  let banded = 0;
  for (const tranche of tranches) {
    const outstanding =
      typeof tranche.outstanding === "number" && Number.isFinite(tranche.outstanding)
        ? Math.max(0, tranche.outstanding)
        : 0;
    if (outstanding <= 0) continue;
    total += outstanding;
    if (tranche.creditBand) banded += outstanding;
    const band = getCreditBand(tranche.creditBand);
    weighted += outstanding * (band.defaultRatePercent / 100) * STRESS_LOSS_MULTIPLIER;
  }
  if (total <= 0) return STRESS_LOSS_FRACTION;
  // A book that is mostly legacy keeps the flat fraction; blending the two on
  // the banded share stops a single new tranche from re-scoring the whole book.
  const bandedShare = banded / total;
  const banded_ = total > 0 ? weighted / total : STRESS_LOSS_FRACTION;
  return bandedShare * banded_ + (1 - bandedShare) * STRESS_LOSS_FRACTION;
}
