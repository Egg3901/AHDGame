import { NextResponse } from "next/server";
import { isSameCountry } from "./sameCountry";

/** Player-facing message when an actor tries to act on another country's party. */
export const CROSS_COUNTRY_ACTION_MESSAGE = "You cannot perform party actions in another country.";

/**
 * Guard for region-scoped party-action routes. Party `sequentialId` is unique
 * per country, so a foreign character's party id can collide onto a same-id
 * party in the URL's country. Reject when the acting character does not belong
 * to the region's country. Applies to EVERYONE (admins included) — these are
 * gameplay actions, not moderation.
 *
 * Returns a ready-to-return 403 `NextResponse`, or `null` when the actor is
 * in-country (caller proceeds). A missing actor `countryId` resolves to "US"
 * via `isSameCountry`, preserving legacy US characters.
 */
export function crossCountryActionGuard(
  actor: { countryId?: string | null } | null | undefined,
  regionCountryId: string
): NextResponse | null {
  if (isSameCountry(actor, { countryId: regionCountryId })) return null;
  return NextResponse.json({ error: CROSS_COUNTRY_ACTION_MESSAGE }, { status: 403 });
}
