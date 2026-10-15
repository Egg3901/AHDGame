/**
 * Subsidiary groups include every formalized descendant. publicSubsidiaryGroups
 * lists nested parents separately and subtracts member-held equity from valuations.
 */
import { resolveMembershipRows } from "./membership";
export interface PublicGroupMember {
  id: string;
  pathId: string;
  name: string;
  logoUrl?: string;
  countryId: string;
  parentId?: string;
  formalized: boolean;
  isNpp?: boolean;
  groupName?: string;
  groupLogoUrl?: string;
  cashAnchor: number | null;
  marketCapAnchor: number | null;
  totalShares: number;
  corporateHoldings: { holderId: string; shares: number }[];
  revenueAnchor: number | null;
  sectors: { industry: string; countryId: string; stateId?: string }[];
}
export interface PublicSubsidiaryGroup {
  id: string;
  pathId: string;
  name: string;
  logoUrl?: string;
  parentName: string;
  countryId: string;
  parentGroupId?: string;
  isNpp: boolean;
  /** Whether this is a valid top-level group for the existing private management page. */
  managementAvailable: boolean;
  members: (Pick<
    PublicGroupMember,
    "id" | "pathId" | "name" | "logoUrl" | "countryId" | "parentId" | "formalized"
  > & { cashAnchor: number | null; revenueAnchor: number | null })[];
  cashAnchor: number | null;
  revenueAnchor: number | null;
  /** Market equity less equity held by another member. Null if any quote is missing. */
  equityValueAnchor: number | null;
  sectorCount: number;
  regionCount: number;
  countries: string[];
  industries: string[];
}

/** Build the public tree with the same canonical cycle root as the engine. */
export function publicGroupStructure(
  rows: readonly Pick<PublicGroupMember, "id" | "parentId" | "formalized">[]
) {
  const ids = new Set(rows.map((row) => row.id));
  const valid = rows.map((row) => ({
    ...row,
    parentId:
      row.parentId && row.parentId !== row.id && ids.has(row.parentId) ? row.parentId : undefined,
  }));
  const membership = resolveMembershipRows(valid);
  const orphanedRoots = new Set(
    rows
      .filter((row) => row.formalized && row.parentId && !ids.has(row.parentId))
      .map((row) => membership.rootByCorpId.get(row.id)!)
  );
  const parentById = new Map<string, string>();
  const children = new Map<string, string[]>();
  for (const row of valid) {
    if (!row.formalized || !row.parentId || membership.rootByCorpId.get(row.id) === row.id)
      continue;
    parentById.set(row.id, row.parentId);
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }
  const membersByRootId = new Map<string, string[]>();
  for (const rootId of children.keys()) {
    const seen = new Set<string>(),
      pending = [rootId];
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    membersByRootId.set(rootId, [...seen]);
  }
  return { parentById, membersByRootId, topRootByCorpId: membership.rootByCorpId, orphanedRoots };
}
function finiteAmount(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}
function sumKnown(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null || !Number.isFinite(value))) return null;
  return finiteAmount(values.reduce<number>((sum, value) => sum + value!, 0));
}
function equityValue(
  members: readonly PublicGroupMember[],
  ids: ReadonlySet<string>
): number | null {
  return sumKnown(
    members.map((member) => {
      if (
        member.marketCapAnchor === null ||
        !Number.isFinite(member.marketCapAnchor) ||
        member.marketCapAnchor < 0 ||
        !Number.isFinite(member.totalShares) ||
        member.totalShares <= 0
      )
        return null;
      const holdings = member.corporateHoldings.filter((holding) => ids.has(holding.holderId));
      if (holdings.some((holding) => !Number.isFinite(holding.shares) || holding.shares < 0))
        return null;
      const shares = holdings.reduce((sum, holding) => sum + holding.shares, 0);
      if (!Number.isFinite(shares) || shares > member.totalShares) return null;
      return finiteAmount(member.marketCapAnchor * (1 - shares / member.totalShares));
    })
  );
}
/** Each corporation with formalized children heads a distinct, overlapping read-only group. */
export function publicSubsidiaryGroups(
  rows: readonly PublicGroupMember[]
): PublicSubsidiaryGroup[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const structure = publicGroupStructure(rows);
  return [...structure.membersByRootId]
    .map(([rootId, memberIds]) => {
      const root = byId.get(rootId)!;
      const ids = new Set(memberIds);
      const members = [...ids].map((id) => byId.get(id)!);
      const sectors = members.flatMap((m) => m.sectors);
      return {
        id: root.id,
        pathId: root.pathId,
        name: root.groupName?.trim() || root.name,
        logoUrl: root.groupLogoUrl || root.logoUrl,
        parentName: root.name,
        isNpp: root.isNpp === true,
        managementAvailable:
          !structure.parentById.has(root.id) &&
          !structure.orphanedRoots.has(structure.topRootByCorpId.get(root.id)!),
        countryId: root.countryId,
        parentGroupId: structure.parentById.get(root.id),
        members: members.map(
          ({ id, pathId, name, logoUrl, countryId, formalized, cashAnchor, revenueAnchor }) => ({
            id,
            pathId,
            name,
            logoUrl,
            countryId,
            parentId: structure.parentById.get(id),
            formalized,
            cashAnchor: finiteAmount(cashAnchor),
            revenueAnchor: finiteAmount(revenueAnchor),
          })
        ),
        cashAnchor: sumKnown(members.map((member) => finiteAmount(member.cashAnchor))),
        revenueAnchor: sumKnown(members.map((member) => finiteAmount(member.revenueAnchor))),
        equityValueAnchor: equityValue(members, ids),
        sectorCount: sectors.length,
        regionCount: new Set(
          sectors
            .filter((s) => s.countryId && s.stateId)
            .map((s) => JSON.stringify([s.countryId, s.stateId]))
        ).size,
        countries: [
          ...new Set(members.map((m) => m.countryId).concat(sectors.map((s) => s.countryId))),
        ]
          .filter(Boolean)
          .sort(),
        industries: [...new Set(sectors.map((s) => s.industry))].sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
