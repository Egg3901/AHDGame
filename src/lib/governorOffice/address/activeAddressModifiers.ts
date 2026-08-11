import type { Db } from "mongodb";
import type { GovernorAddress } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { getNationalStateId } from "@/lib/policy/nationalStateId";

/**
 * Returns the active (non-expired) governor-address approval bump(s) for a
 * state as ActiveModifier[]. The State of the State address's approval bump
 * is injected via this helper rather than written into approvalModifiers.ts
 * because the source of truth lives on the address row.
 *
 * Cooldown means there's effectively at most one active address at any time,
 * but we don't rely on that — we return a modifier per non-expired row.
 */
export async function getActiveAddressApprovalModifiers(
  db: Db,
  countryId: CountryId,
  stateId: string,
  currentTurn: number
): Promise<ActiveModifier[]> {
  const active = await db
    .collection<GovernorAddress>("governorAddresses")
    .find({
      countryId,
      stateId,
      "approvalEffect.expiresAtTurn": { $gt: currentTurn },
    })
    .toArray();
  return active.map((addr) => ({
    id: `address:${addr._id?.toString() ?? "unknown"}`,
    label: addr.title ? `Address: "${addr.title}"` : `Address by ${addr.deliveredByName}`,
    effect: addr.approvalEffect.amount,
    source: "address" as const,
  }));
}

/**
 * National-scope wrapper around getActiveAddressApprovalModifiers. Returns
 * the active national-address approval bumps for a country (typically 0 or
 * 1 entries given the per-office cooldown).
 */
export async function getActiveNationalAddressModifier(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<ActiveModifier[]> {
  const stateId = getNationalStateId(countryId);
  return getActiveAddressApprovalModifiers(db, countryId, stateId, currentTurn);
}
