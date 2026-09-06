import type { Corporation } from "@/lib/db/types";
import { loyaltyLabel } from "@/lib/market/brandLoyalty";

/**
 * Brand loyalty disclosure for the corporation detail view (#587).
 *
 * The raw 0–100 number and the corp's price-identity norm are owner-only
 * intel; everyone else gets the hidden 5-label scale and never the number.
 * Absent loyalty means the feature is disabled for this corp, so the fields
 * are omitted entirely and the UI hides the indicator rather than showing a
 * misleading 0.
 *
 * State-owned corps have no private owner, so `countryOwnerId` disqualifies a
 * viewer from the owner view even when the `userId` matches.
 */
export interface BrandLoyaltyFields {
  brandLoyaltyLabel?: string;
  brandLoyalty?: number;
  brandPostureNorm?: number;
}

export function buildBrandLoyaltyFields(
  corporation: Pick<Corporation, "brandLoyalty" | "brandPostureNorm" | "userId" | "countryOwnerId">,
  viewerUserId: string | null | undefined
): BrandLoyaltyFields {
  const value = corporation.brandLoyalty;
  if (value == null) return {};

  const viewerIsOwner =
    !!viewerUserId &&
    corporation.userId?.toString() === viewerUserId &&
    !corporation.countryOwnerId;

  return {
    brandLoyaltyLabel: loyaltyLabel(value),
    ...(viewerIsOwner
      ? {
          brandLoyalty: Math.round(value * 10) / 10,
          brandPostureNorm: corporation.brandPostureNorm,
        }
      : {}),
  };
}
