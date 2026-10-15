/** Public subsidiary-group structure and totals, including every nested descendant. */
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
  cashAnchor: number;
  marketCapAnchor: number | null;
  totalShares: number;
  corporateHoldings: { holderId: string; shares: number }[];
  revenueAnchor: number;
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
  members: Pick<
    PublicGroupMember,
    | "id"
    | "pathId"
    | "name"
    | "logoUrl"
    | "countryId"
    | "parentId"
    | "formalized"
    | "cashAnchor"
    | "revenueAnchor"
  >[];
  cashAnchor: number;
  revenueAnchor: number;
  /** Market equity less equity held by another member. Null if any quote is missing. */
  equityValueAnchor: number | null;
  sectorCount: number;
  regionCount: number;
  countries: string[];
  industries: string[];
}

/** Each corporation with formalized children heads a distinct, overlapping read-only group. */
export function publicSubsidiaryGroups(
  rows: readonly PublicGroupMember[]
): PublicSubsidiaryGroup[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.formalized || !row.parentId || !byId.has(row.parentId) || row.parentId === row.id)
      continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }
  return [...children.keys()]
    .map((rootId) => {
      const root = byId.get(rootId)!;
      const ids = new Set<string>();
      const pending = [rootId];
      while (pending.length) {
        const id = pending.pop()!;
        if (ids.has(id)) continue;
        ids.add(id);
        pending.push(...(children.get(id) ?? []));
      }
      const members = [...ids].map((id) => byId.get(id)!);
      const sectors = members.flatMap((m) => m.sectors);
      return {
        id: root.id,
        pathId: root.pathId,
        name: root.groupName?.trim() || root.name,
        logoUrl: root.groupLogoUrl || root.logoUrl,
        parentName: root.name,
        isNpp: root.isNpp === true,
        countryId: root.countryId,
        parentGroupId:
          root.formalized && root.parentId && children.has(root.parentId)
            ? root.parentId
            : undefined,
        members: members.map(
          ({
            id,
            pathId,
            name,
            logoUrl,
            countryId,
            parentId,
            formalized,
            cashAnchor,
            revenueAnchor,
          }) => ({
            id,
            pathId,
            name,
            logoUrl,
            countryId,
            parentId,
            formalized,
            cashAnchor,
            revenueAnchor,
          })
        ),
        cashAnchor: members.reduce((sum, m) => sum + m.cashAnchor, 0),
        revenueAnchor: members.reduce((sum, m) => sum + m.revenueAnchor, 0),
        equityValueAnchor: members.some((m) => m.marketCapAnchor === null)
          ? null
          : members.reduce((sum, m) => {
              const internalShares = m.corporateHoldings
                .filter((h) => ids.has(h.holderId))
                .reduce((n, h) => n + Math.max(0, h.shares), 0);
              return sum + m.marketCapAnchor! * (1 - Math.min(1, internalShares / m.totalShares));
            }, 0),
        sectorCount: sectors.length,
        regionCount: new Set(
          sectors.filter((s) => s.stateId).map((s) => JSON.stringify([s.countryId, s.stateId]))
        ).size,
        countries: [
          ...new Set(members.map((m) => m.countryId).concat(sectors.map((s) => s.countryId))),
        ]
          .filter(Boolean)
          .sort(),
        industries: [...new Set(sectors.map((s) => s.industry))].sort(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
