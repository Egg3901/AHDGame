/**
 * Anchor to a character's own currency, in one place.
 *
 * The four-line dance of "is forex on, if so load the rate, otherwise 1" was
 * copied into the presence build route, the state-attack route, the primary
 * viewer campaign and the state operations builder. Copies drift: the surfaces
 * that quoted Campaign Presence disagreed about whether to convert at all, so
 * two of the three quoted a figure the server never charges.
 */

import type { Db } from "mongodb";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { PersonalWealthHolder } from "@/lib/currency/characterFunds";

/**
 * Local units per anchor for this character's home currency. Exactly 1 when
 * forex is off, and 1 when the rate document is missing, matching
 * `loadCharacterFxRate`'s own fallback.
 */
export async function loadCampaignFxRate(db: Db, character: PersonalWealthHolder): Promise<number> {
  if (!(await isForexEnabled())) return 1;
  const { rate } = await loadCharacterFxRate(db, getHomeCurrency(character));
  return rate;
}
