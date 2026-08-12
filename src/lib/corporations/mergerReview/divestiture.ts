/**
 * Is the divestiture order actually satisfied?
 *
 * Measured, not procedural. A spin-off alone does NOT discharge the order: the
 * spun-off corporation is wholly parent-owned at creation, so the same group
 * still holds the same share of the same market. Moving a business into a
 * subsidiary is a filing, not a divestiture. Selling it down until the group no
 * longer controls it is.
 *
 * So the test is: does the acquirer's CONTROLLED GROUP still hold at or above
 * the threshold in the ordered industry? The group is the corp plus every
 * corporation it controls (>50% voting power), which is the same de-facto
 * control definition the subsidiary model uses. Spin off and sell down and the
 * order clears; spin off and keep it and the order stands.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getControllingCorporateParent } from "../corporateOwnership";
import { computeMarketSharePercent } from "../marketShare";
import { loadIndustryBasis } from "../corpMarketShare";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

/**
 * Every corporation under the acquirer's control, including itself. Walks
 * downward from the whole corp set rather than recursing per corp, so a chain
 * (A controls B controls C) resolves in one pass and an ownership cycle cannot
 * loop it.
 */
export async function controlledGroupIds(db: Db, rootId: ObjectId): Promise<Set<string>> {
  // Only the vote-weight fields are read, so the scan stays cheap on documents
  // that are otherwise very fat.
  const corps = (await db
    .collection<Corporation>("corporations")
    .find({}, { projection: { shareholders: 1, totalShares: 1, superShareMultiplier: 1 } })
    .toArray()) as Corporation[];

  const parentOf = new Map<string, string>();
  for (const corp of corps) {
    const parent = getControllingCorporateParent(corp);
    if (parent) parentOf.set(corp._id.toString(), parent.corporationId.toString());
  }

  const group = new Set<string>([rootId.toString()]);
  // Repeat until no new member is added. Bounded by the corp count, so a cycle
  // in `parentOf` terminates instead of spinning.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [childId, parentId] of parentOf) {
      if (group.has(parentId) && !group.has(childId)) {
        group.add(childId);
        grew = true;
      }
    }
  }
  return group;
}

/**
 * The controlled group's combined share of one industry in one country, on the
 * shared `loadIndustryBasis` denominator.
 */
export async function groupIndustrySharePercent(
  db: Db,
  rootId: ObjectId,
  countryId: CountryId,
  sectorType: CorporationType,
  plantsEnabled: boolean
): Promise<number> {
  const byType = await loadIndustryBasis(db, countryId, [sectorType], plantsEnabled);
  const basis = byType.get(sectorType);
  if (!basis || basis.basisMarket <= 0) return 0;

  const group = await controlledGroupIds(db, rootId);
  let groupBasis = 0;
  for (const [corpId, value] of basis.basisByCorp) {
    if (group.has(corpId)) groupBasis += value;
  }
  return Math.round(computeMarketSharePercent(groupBasis, basis.basisMarket) * 100) / 100;
}

/**
 * Discharge the acquirer's divestiture order if its group has fallen back below
 * the threshold the review measured it against. Safe to call opportunistically
 * (after a spin-off, a share sale, a sector sale) and from the turn sweep.
 *
 * Returns true when the order was discharged by this call.
 */
export async function settleDivestitureIfSatisfied(
  db: Db,
  corporation: Pick<Corporation, "_id" | "pendingDivestiture">
): Promise<boolean> {
  const obligation = corporation.pendingDivestiture;
  if (!obligation) return false;

  const marketMode = await getMarketSystemModeForDb(db);
  const share = await groupIndustrySharePercent(
    db,
    corporation._id,
    obligation.countryId as CountryId,
    obligation.sectorType,
    marketAtLeast(marketMode, "plants")
  );
  if (share >= obligation.thresholdPercent) return false;

  await db
    .collection<Corporation>("corporations")
    .updateOne(
      { _id: corporation._id },
      { $unset: { pendingDivestiture: "" }, $set: { updatedAt: new Date() } }
    );
  return true;
}
