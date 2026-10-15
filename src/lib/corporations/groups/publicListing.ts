/**
 * Subsidiary groups list each parent and its formalized descendants separately.
 * loadPublicSubsidiaryGroups converts public cash, revenue and equity into anchor currency.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector, GameState } from "@/lib/db/types";
import { getControllingCorporateParent } from "../corporateOwnership";
import { shouldRedactCorporation } from "../redaction";
import {
  corporationWithReservedHoldings,
  loadReservedCorporatePositionsByTarget,
} from "../reservedCorporateHoldings";
import {
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  loadValuationFxRates,
  fxRateForCorpFromMap,
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import {
  publicSubsidiaryGroups,
  publicGroupStructure,
  type PublicGroupMember,
} from "./rules/publicListing";
export async function loadPublicSubsidiaryGroups(db: Db, corporationId?: string) {
  const world = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } });
  // Feature discovery follows the toggle; existing group bookmarks remain readable.
  if (!world?.subsidiaryCorporationsEnabled && !corporationId) return [];
  const [corps, reserved, fx] = await Promise.all([
    db
      .collection<Corporation>("corporations")
      .find(
        {},
        {
          projection: {
            name: 1,
            isPrivate: 1,
            sequentialId: 1,
            logoUrl: 1,
            countryId: 1,
            groupManagement: 1,
            shareholders: 1,
            totalShares: 1,
            superShareMultiplier: 1,
            subsidiaryFormalizedAtTurn: 1,
            liquidCapital: 1,
            liquidCurrencyCode: 1,
            sharePrice: 1,
            countryOwnerId: 1,
            suspended: 1,
            ceoVacant: 1,
            ceoId: 1,
            ceoType: 1,
          },
        }
      )
      .toArray(),
    loadReservedCorporatePositionsByTarget(db),
    loadValuationFxRates(db),
  ]);
  const effectiveById = new Map(
    corps.map((corp) => [
      corp._id.toString(),
      corporationWithReservedHoldings(corp, reserved.get(corp._id.toString()) ?? []),
    ])
  );
  const parentById = new Map(
    [...effectiveById].map(([id, corp]) => [
      id,
      getControllingCorporateParent(corp)?.corporationId.toString(),
    ])
  );
  const structure = publicGroupStructure(
    corps.map((corp) => ({
      id: corp._id.toString(),
      parentId: parentById.get(corp._id.toString()),
      formalized: corp.subsidiaryFormalizedAtTurn != null,
    }))
  );
  const selectedRoot =
    corporationId &&
    (structure.membersByRootId.has(corporationId)
      ? corporationId
      : structure.topRootByCorpId.get(corporationId));
  const groupedIds = new Set(
    corporationId
      ? (selectedRoot && structure.membersByRootId.get(selectedRoot)) || []
      : [...structure.membersByRootId.values()].flat()
  );
  const groupedCorps = corps.filter((corp) => groupedIds.has(corp._id.toString()));
  if (!groupedCorps.length) return [];
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: groupedCorps.map((c) => c._id) } },
      { projection: { corporationId: 1, sectorType: 1, countryId: 1, stateId: 1, revenue: 1 } }
    )
    .toArray();
  const byCorp = new Map<string, CorporateSector[]>();
  for (const sector of sectors) {
    const id = sector.corporationId?.toString();
    if (!id) continue;
    const list = byCorp.get(id) ?? [];
    list.push(sector);
    byCorp.set(id, list);
  }
  const rows: PublicGroupMember[] = groupedCorps.map((corp) => {
    const id = corp._id.toString();
    const effective = effectiveById.get(id)!;
    const rate = fxRateForCorpFromMap(corp, fx);
    const privateFinancials = shouldRedactCorporation(corp, undefined, false);
    const owned = byCorp.get(id) ?? [];
    return {
      id,
      pathId: String(corp.sequentialId ?? id),
      name: corp.name,
      logoUrl: corp.logoUrl,
      countryId: corp.countryId,
      parentId: parentById.get(id),
      formalized: corp.subsidiaryFormalizedAtTurn != null,
      isNpp: corp.ceoType === "npp",
      groupName: corp.groupManagement?.name,
      groupLogoUrl: corp.groupManagement?.logoUrl,
      cashAnchor: privateFinancials
        ? null
        : corpLiquidCapitalToAnchor(corp.liquidCapital ?? 0, corp, rate),
      marketCapAnchor:
        !privateFinancials &&
        Number.isFinite(corp.sharePrice) &&
        corp.sharePrice >= 0 &&
        corp.totalShares > 0
          ? corpLiquidCapitalToAnchor(corp.sharePrice * corp.totalShares, corp, rate)
          : null,
      totalShares: corp.totalShares,
      corporateHoldings: (effective.shareholders ?? []).flatMap((h) =>
        h.corporationId ? [{ holderId: h.corporationId.toString(), shares: h.shares }] : []
      ),
      revenueAnchor: privateFinancials
        ? null
        : owned.reduce(
            (sum, s) =>
              sum +
              corpCapitalToAnchor(
                s.revenue ?? 0,
                resolveSectorHostCurrencyCode(s, corp),
                fxRateForSectorHostFromMap(s, corp, fx)
              ),
            0
          ),
      sectors: owned.map((s) => ({
        industry: s.sectorType,
        countryId: s.countryId ?? corp.countryId,
        stateId: s.stateId,
      })),
    };
  });
  return publicSubsidiaryGroups(rows).map((group) => ({
    ...group,
    parentGroupId: structure.parentById.get(group.id),
    managementAvailable:
      !structure.parentById.has(group.id) &&
      !structure.orphanedRoots.has(structure.topRootByCorpId.get(group.id)!),
    members: group.members.map((member) => ({
      ...member,
      parentId: structure.parentById.get(member.id),
    })),
  }));
}
