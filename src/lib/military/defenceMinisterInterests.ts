import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { resolveSelfDealing, type SelfDealingBasis } from "@/lib/military/defenceSelfDealing";

/**
 * A defence supplier the minister has a stake in, OTHER than the one in front of them.
 *
 * `resolveSelfDealing` answers "does the minister own the company they are paying". This
 * answers the mirror question, which is the one a cancellation raises: does the minister own a
 * company that stands to pick up the work. Same two bases, same 5% materiality line, so a
 * player cannot be conflicted on one side of the desk and clean on the other.
 */
export interface CompetingSupplierInterest {
  corporationId: ObjectId;
  name: string;
  basis: SelfDealingBasis;
  stakeShare: number;
}

/**
 * The strongest competing interest, or null when the minister has none.
 *
 * Scoped to the buying country because a defence contract is domestic by construction (see
 * `DefenceContract`): a stake in a foreign arms firm cannot receive this order, so it is not a
 * conflict on this decision. Restricted to corporations that actually hold a defence plant,
 * for the same reason. A minister who owns a bakery is not competing for a submarine contract.
 *
 * Ownership is preferred over a shareholding when the minister has both, and among
 * shareholdings the largest wins, so the disclosure names the interest hardest to explain away.
 */
export async function findCompetingSupplierInterest(
  db: Db,
  input: {
    countryId: string;
    ministerUserId?: ObjectId | null;
    ministerCharacterId?: ObjectId | null;
    excludeCorporationId: ObjectId;
  }
): Promise<CompetingSupplierInterest | null> {
  const { ministerUserId, ministerCharacterId } = input;
  if (!ministerUserId && !ministerCharacterId) return null;

  const or: Record<string, unknown>[] = [];
  if (ministerUserId) or.push({ userId: ministerUserId });
  if (ministerCharacterId) or.push({ "shareholders.characterId": ministerCharacterId });

  const candidates = await db
    .collection<Corporation>("corporations")
    .find({
      countryId: input.countryId,
      _id: { $ne: input.excludeCorporationId },
      $or: or,
    } as never)
    .project({ _id: 1, name: 1, userId: 1, shareholders: 1, totalShares: 1 })
    .toArray();
  if (candidates.length === 0) return null;

  // Only corporations with a defence plant compete for this order. One query for the whole
  // candidate set rather than one per candidate: a minister with a broad portfolio would
  // otherwise turn a single cancellation into a dozen round trips.
  const defenceSectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({
      corporationId: { $in: candidates.map((c) => c._id) },
      sectorType: "defense",
    })
    .project({ corporationId: 1 })
    .toArray();
  const armed = new Set(defenceSectors.map((s) => s.corporationId.toString()));

  let best: CompetingSupplierInterest | null = null;
  for (const corp of candidates) {
    if (!armed.has(corp._id.toString())) continue;
    const finding = resolveSelfDealing({
      corp: corp as Pick<Corporation, "userId" | "shareholders" | "totalShares">,
      ministerUserId,
      ministerCharacterId,
    });
    if (!finding.basis) continue;
    const candidate: CompetingSupplierInterest = {
      corporationId: corp._id,
      name: corp.name ?? "an unnamed company",
      basis: finding.basis,
      stakeShare: finding.stakeShare,
    };
    if (!best) {
      best = candidate;
      continue;
    }
    if (best.basis !== "owner" && candidate.basis === "owner") {
      best = candidate;
      continue;
    }
    if (best.basis === candidate.basis && candidate.stakeShare > best.stakeShare) {
      best = candidate;
    }
  }
  return best;
}
