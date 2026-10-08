import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types/corporation";
import { MATERIAL_STAKE_SHARE, resolveSelfDealing } from "@/lib/military/defenceSelfDealing";

/**
 * Related-party rules for supply contracts. Two corporations are related when
 * the premium and damages legs between them could move cash between pockets
 * rather than between counterparties. Pure: plain documents in, answer out.
 *
 * "Related" is bounded to what the data records: the same owning user, the
 * same CEO, or a material holding (at least {@link MATERIAL_STAKE_SHARE}) of
 * one by the other's owner, CEO character or holding corporation.
 */

export type RelatedPartyBasis = "owner" | "ceo" | "shareholding";

export type RelatedPartyCorp = Pick<
  Corporation,
  "_id" | "userId" | "ceoId" | "ceoType" | "shareholders" | "totalShares"
>;

const same = (a: ObjectId | null | undefined, b: ObjectId | null | undefined): boolean =>
  a != null && b != null && a.toString() === b.toString();

function corporationStake(holder: RelatedPartyCorp, held: RelatedPartyCorp): number {
  const total = held.totalShares;
  if (!(typeof total === "number") || !(total > 0)) return 0;
  const shares = (held.shareholders ?? [])
    .filter((h) => same(h.corporationId, holder._id))
    .reduce((sum, h) => sum + Math.max(0, h.shares ?? 0), 0);
  return shares / total;
}

/** Does `holder`'s owner, CEO character or corporation hold a material stake in `held`? */
function holdsMaterialStake(holder: RelatedPartyCorp, held: RelatedPartyCorp): boolean {
  const personal = resolveSelfDealing({
    corp: held,
    ministerUserId: holder.userId,
    ministerCharacterId: holder.ceoType === "character" || !holder.ceoType ? holder.ceoId : null,
  });
  if (personal.basis === "shareholding") return true;
  return corporationStake(holder, held) >= MATERIAL_STAKE_SHARE;
}

/** The strongest relationship between two corporations, or null when they are at arm's length. */
export function resolveRelatedParty(
  a: RelatedPartyCorp,
  b: RelatedPartyCorp
): RelatedPartyBasis | null {
  if (same(a.userId, b.userId)) return "owner";
  if (same(a.ceoId, b.ceoId) && (a.ceoType ?? "character") === (b.ceoType ?? "character")) {
    return "ceo";
  }
  if (holdsMaterialStake(a, b) || holdsMaterialStake(b, a)) return "shareholding";
  return null;
}

export const RELATED_PARTY_MESSAGE =
  "Related corporations cannot contract with each other. The same owner, the same CEO, or a 5% shareholding on either side counts.";
