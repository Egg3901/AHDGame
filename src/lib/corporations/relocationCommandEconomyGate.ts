/**
 * Relocation side of the private-enterprise gate.
 *
 * Moving a private corporation's headquarters into a country whose economy is
 * still fully command is founding a private enterprise there by another route,
 * so every relocation path asks this before it moves a corporation across a
 * border. The marketization dial decides (`isPrivateEnterpriseBlocked`), so a
 * country that liberalizes opens to relocation on the same turn it opens to
 * founding. State-owned corporations are exempt, and a move inside the
 * corporation's own country is never blocked: it brings nothing new in.
 */
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isPrivateEnterpriseBlocked } from "@/lib/economy/queries/privateEnterpriseGate";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

/** Player-facing refusal for a move into a command economy. */
export function commandEconomyRelocationError(destinationCountryId: string): string {
  const name = COUNTRY_CONFIGS[destinationCountryId as CountryId]?.name ?? destinationCountryId;
  return `${name} has a state-run economy, so private corporations can't move their headquarters there until private enterprise is legal.`;
}

/**
 * The refusal message when this move would bring a private corporation into a
 * command economy, otherwise null. Fails closed like the founding gate.
 */
export async function commandEconomyRelocationBlock(
  db: Db,
  corporation: Pick<Corporation, "countryOwnerId" | "ownershipState">,
  currentCountryId: string | null | undefined,
  destinationCountryId: string | null | undefined
): Promise<string | null> {
  if (!destinationCountryId || destinationCountryId === currentCountryId) return null;
  if (isStateOwned(corporation)) return null;
  return (await isPrivateEnterpriseBlocked(db, destinationCountryId))
    ? commandEconomyRelocationError(destinationCountryId)
    : null;
}
