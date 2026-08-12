/**
 * Index-fund ownership of a corporation, and the issuer-side benefits it earns.
 *
 * Before this, index funds were an entirely one-way system: `fundCron` absorbed
 * public float, `fundCrossRebalancing` moved holdings between funds, and
 * `dividendPassThrough` paid unit holders — but the CORPORATION being held got
 * nothing for it. Nothing in the credit model or the share-price formula looked
 * at fund ownership at all. The Global Top 50 sat at two or three real holdings
 * because inclusion bought the issuer precisely zero (suggestion #62).
 *
 * Real issuers care a great deal about index membership: a wider, stickier
 * holder base is cheaper capital and a firmer bid under the stock. Both legs are
 * modelled here, deliberately as the mirror image of the insider-concentration
 * penalties that already exist — concentrated insider ownership is punished, a
 * broad passive base is rewarded, and they use the same shapes so the two can be
 * reasoned about together.
 */

import type { Corporation } from "@/lib/db/types";

/**
 * Fraction of shares held by index funds at which a corp earns the issuer
 * benefits. Set at the level a fund's normal float absorption can actually
 * reach, so inclusion in one real fund is enough to matter.
 */
export const INDEX_INCLUSION_THRESHOLD = 0.1;

/** Share-price premium at fully-saturated index ownership. */
export const INDEX_INCLUSION_MAX_PREMIUM = 0.08;

/**
 * Index ownership at which the price premium tops out. Above this, extra
 * passive ownership adds nothing: the liquidity benefit is real but bounded,
 * and an uncapped ramp would make float absorption a valuation lever.
 */
export const INDEX_INCLUSION_PREMIUM_SATURATION = 0.35;

/**
 * Fraction of `totalShares` held by index funds (0–1).
 *
 * Counts only `fundId` shareholders — character, corporate, imperial and NPP
 * positions are not passive holders and earn nothing here. Returns 0 for a corp
 * with no share structure rather than dividing by zero.
 */
export function indexFundOwnershipFraction(
  corporation: Pick<Corporation, "shareholders" | "totalShares">
): number {
  const totalShares = corporation.totalShares;
  if (!Number.isFinite(totalShares) || (totalShares ?? 0) <= 0) return 0;
  const fundShares = (corporation.shareholders ?? []).reduce(
    (sum, sh) =>
      sh.fundId != null && Number.isFinite(sh.shares) ? sum + Math.max(0, sh.shares) : sum,
    0
  );
  return Math.min(1, fundShares / (totalShares as number));
}

/** True when index ownership has reached {@link INDEX_INCLUSION_THRESHOLD}. */
export function qualifiesForIndexInclusionBenefit(indexOwnershipFraction: number): boolean {
  return (
    Number.isFinite(indexOwnershipFraction) && indexOwnershipFraction >= INDEX_INCLUSION_THRESHOLD
  );
}

/**
 * Share-price multiplier for index inclusion.
 *
 * Returns 1 below {@link INDEX_INCLUSION_THRESHOLD}, then ramps linearly to
 * 1 + {@link INDEX_INCLUSION_MAX_PREMIUM} at
 * {@link INDEX_INCLUSION_PREMIUM_SATURATION} and holds flat above it.
 *
 * Continuous at the threshold (premium starts at 0, not at the cap), so
 * crossing it is not a step change a holder could farm by cycling in and out.
 */
export function indexInclusionPriceMultiplier(indexOwnershipFraction: number): number {
  if (!Number.isFinite(indexOwnershipFraction)) return 1;
  if (indexOwnershipFraction <= INDEX_INCLUSION_THRESHOLD) return 1;
  const span = INDEX_INCLUSION_PREMIUM_SATURATION - INDEX_INCLUSION_THRESHOLD;
  const over =
    Math.min(indexOwnershipFraction, INDEX_INCLUSION_PREMIUM_SATURATION) -
    INDEX_INCLUSION_THRESHOLD;
  const t = span > 0 ? over / span : 1;
  return 1 + INDEX_INCLUSION_MAX_PREMIUM * t;
}
