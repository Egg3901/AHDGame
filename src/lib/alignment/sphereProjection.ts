/**
 * The seam between alignment and the sphere system.
 *
 * Alignment is the CAUSE — how drawn a nation is to each pole. The sphere is
 * the EFFECT — who it belongs to right now. `resolvePrimarySphere` already
 * flips membership on a margin; this is what gives it a real number to flip on,
 * so drifting sympathy turns into actual migration between blocs.
 */
import {
  ALIGNMENT_POLES,
  joinGateForPoleCount,
  polesForYear,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import type { CountryId } from "@/lib/constants/countries";
import type { SphereMembership } from "@/lib/world/spheres/types";
import type { AlignmentShares } from "./normalize";
import { statusFor } from "./project";

/**
 * The patron country a pole speaks for, or null for the Non-Aligned Movement:
 * it has no sponsor by definition, which is precisely why a nation it leads
 * has no primary sphere.
 */
export function sponsorForPole(pole: AlignmentPoleId): CountryId | null {
  return ALIGNMENT_POLES[pole].leaderCountryId ?? null;
}

/**
 * Pole shares (0–100) expressed as the sphere system's per-sponsor alignment
 * (0–1). Deliberately no rescaling, so a sphere threshold such as
 * PROPOSE_TO_ACTIVE_ALIGNMENT (0.28) reads as "28% of this nation's sympathy" —
 * a sentence that means something.
 *
 * Every sponsored pole of the era appears, including at zero, so a sponsor that
 * has lost all standing is recorded as having lost it rather than vanishing.
 */
export function projectSphereAlignment(params: {
  shares: AlignmentShares;
  year: number;
}): Map<CountryId, number> {
  const out = new Map<CountryId, number>();
  for (const pole of polesForYear(params.year)) {
    const sponsor = sponsorForPole(pole);
    if (!sponsor) continue;
    out.set(sponsor, (params.shares.shares[pole] ?? 0) / 100);
  }
  return out;
}

/**
 * Who this nation is with now, or null when nobody has committed it.
 *
 * Gates on the SAME join gate the Ledger's bands use, so the page and the
 * sphere system can never disagree about who counts as committed.
 */
export function primarySphereFor(params: {
  shares: AlignmentShares;
  year: number;
}): CountryId | null {
  const poles = polesForYear(params.year);
  const { topPoleId, lead } = statusFor({
    shares: params.shares,
    poleCount: poles.length,
    isPlayer: false,
    isMember: false,
  });
  if (!topPoleId) return null;
  if (lead < joinGateForPoleCount(poles.length)) return null;
  return sponsorForPole(topPoleId);
}

/**
 * Write a nation's alignment through onto its sphere membership: each sponsor's
 * `alignment` becomes that sponsor's pole share, and the primary sphere becomes
 * whoever the nation has actually committed to. This is what turns drift into
 * migration.
 *
 * Deliberately conservative in three ways:
 * - Only EXISTING relationships are updated. Creating one is the `court`
 *   intent's job; alignment alone does not manufacture a patron.
 * - `integration` is never touched. It is economic entanglement, which is
 *   sphere-owned and legitimately lags political sympathy.
 * - The primary is only cleared when the membership can legally have none.
 *   `assertValidSphereMembership` requires a primary once there are two or more
 *   relationships, so an uncommitted nation with several patrons keeps a
 *   nominal one — its Ledger band still reads Contested or Non-aligned.
 */
export function applyAlignmentToMembership(params: {
  membership: SphereMembership;
  shares: AlignmentShares;
  year: number;
}): SphereMembership {
  const { membership } = params;
  const projected = projectSphereAlignment({ shares: params.shares, year: params.year });

  const relationships = membership.relationships.map((rel) => {
    const next = projected.get(rel.sponsorId as CountryId);
    return next === undefined ? rel : { ...rel, alignment: next };
  });

  const sponsors = new Set(relationships.map((r) => r.sponsorId));
  const committed = primarySphereFor({ shares: params.shares, year: params.year });

  let primarySphereId = membership.primarySphereId;
  if (committed && sponsors.has(committed)) {
    primarySphereId = committed;
  } else if (!committed) {
    // Nobody has committed them. Drop the primary if the shape allows it,
    // otherwise fall back to the strongest surviving tie so the record stays
    // valid rather than throwing on save.
    primarySphereId =
      relationships.length <= 1
        ? null
        : [...relationships].sort((a, b) => b.alignment - a.alignment)[0]!.sponsorId;
  }

  return { ...membership, relationships, primarySphereId };
}
