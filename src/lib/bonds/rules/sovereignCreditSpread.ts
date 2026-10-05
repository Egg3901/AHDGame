/**
 * Price new sovereign debt using the existing issuer credit tier and plain
 * term/credibility inputs. Missing or malformed spreads remain neutral.
 */
import { CREDIT_RATING_SPREADS, type CreditRating } from "@/lib/db/types/centralBank";

export function sovereignCreditSpreadPp(rating: unknown): number {
  if (typeof rating !== "string") return 0;
  const spread = CREDIT_RATING_SPREADS[rating as CreditRating];
  return typeof spread === "number" && Number.isFinite(spread) && spread >= 0 ? spread : 0;
}

/** Combine percentage-point premiums once and round the contractual coupon to two decimals. */
export function calculateSovereignCouponRate(input: {
  primeRate: number;
  termPremiumPp: number;
  credibilitySpreadPp?: number;
  issuerRiskSpreadPp?: number;
}): number {
  const neutralUnlessValid = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  return (
    Math.round(
      (input.primeRate +
        input.termPremiumPp +
        neutralUnlessValid(input.credibilitySpreadPp) +
        neutralUnlessValid(input.issuerRiskSpreadPp)) *
        100
    ) / 100
  );
}
