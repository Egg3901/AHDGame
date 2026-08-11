import type { Db } from "mongodb";
import type { MajoritarianBonusConfig } from "./seatAllocation";

interface OrgRow {
  stateId: string;
  partyId: string;
  organization?: number;
}

/**
 * Party ids ranked by state organization, descending (ties: partyId asc for
 * determinism). Feeds `MajoritarianBonusConfig.orgRanking` so the FPTP
 * winner's boost belongs to the two best-organized parties in the state
 * (ticket #1032), not to whichever party pooled the most candidates.
 */
export async function loadCommonsOrgRanking(
  db: Db,
  countryId: string,
  stateId: string
): Promise<string[]> {
  const rows = await db
    .collection<OrgRow>("statePartyOrg")
    .find({ countryId, stateId }, { projection: { partyId: 1, organization: 1 } })
    .toArray();
  return rankByOrganization(rows);
}

/**
 * Bulk variant for callers reallocating every region of a country (heal
 * routes): one query, stateId → org-ranked party ids.
 */
export async function loadCommonsOrgRankings(
  db: Db,
  countryId: string
): Promise<Map<string, string[]>> {
  const rows = await db
    .collection<OrgRow>("statePartyOrg")
    .find({ countryId }, { projection: { stateId: 1, partyId: 1, organization: 1 } })
    .toArray();
  const byState = new Map<string, OrgRow[]>();
  for (const row of rows) {
    const list = byState.get(row.stateId) ?? [];
    list.push(row);
    byState.set(row.stateId, list);
  }
  return new Map([...byState.entries()].map(([sid, list]) => [sid, rankByOrganization(list)]));
}

/** Sort statePartyOrg-shaped rows into an org-descending partyId ranking. */
export function rankPartiesByOrganization(
  rows: { partyId: string; organization?: number }[]
): string[] {
  return rankByOrganization(rows.map((r) => ({ stateId: "", ...r })));
}

function rankByOrganization(rows: OrgRow[]): string[] {
  return [...rows]
    .sort(
      (a, b) =>
        (b.organization ?? 0) - (a.organization ?? 0) ||
        (a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0)
    )
    .map((r) => r.partyId);
}

/**
 * Attaches the state's org ranking to a majoritarian bonus config. Identity
 * on an undefined config (non-FPTP chamber or modern year) or missing state,
 * so call sites can wrap `getMajoritarianBonus(...)` unconditionally.
 */
export async function withCommonsOrgRanking(
  db: Db,
  bonus: MajoritarianBonusConfig | undefined,
  countryId: string,
  stateId: string | undefined
): Promise<MajoritarianBonusConfig | undefined> {
  if (!bonus || !stateId) return bonus;
  const orgRanking = await loadCommonsOrgRanking(db, countryId, stateId);
  return orgRanking.length > 0 ? { ...bonus, orgRanking } : bonus;
}
