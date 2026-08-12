/**
 * The group balance sheet: what a parent actually controls, rather than what
 * its own corporation document says.
 *
 * A parent's page shows the parent's cash, the parent's sectors, the parent's
 * revenue. For a corporation whose business is held through subsidiaries, every
 * one of those numbers understates it, and there is nowhere to see the real
 * position at all.
 *
 * This is a READ surface. It consolidates nothing in the engine — the members
 * keep their own balance sheets, their own share prices and their own
 * shareholders. What it does is answer "how big is this group" with one number
 * instead of making a player add up subsidiaries by hand.
 *
 * Intra-group holdings are netted out. Counting a parent's stake in its own
 * subsidiary as an asset AND counting that subsidiary's sectors would be
 * double-counting the same business.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  corpLiquidCapitalToAnchor,
  loadFxRatesByCurrency,
  fxRateForCorpFromMap,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { resolveFormalizedGroups } from "./groupMembership";

export interface GroupMemberSummary {
  corporationId: string;
  name: string;
  tickerSymbol?: string;
  countryId: string;
  isRoot: boolean;
  liquidCapitalAnchor: number;
  revenueAnchor: number;
  sectorCount: number;
}

export interface GroupBalanceSheet {
  rootCorporationId: string;
  rootName: string;
  memberCount: number;
  members: GroupMemberSummary[];
  /** Sum of every member's liquid capital, in ₳. */
  totalLiquidCapitalAnchor: number;
  /** Sum of every member's sector revenue, in ₳. */
  totalRevenueAnchor: number;
  totalSectorCount: number;
  /** Industries the group operates in anywhere, deduplicated. */
  industries: CorporationType[];
  /** Countries the group has sectors in. */
  countries: string[];
}

/**
 * Build the consolidated view for the group containing `corporationId`. Returns
 * null when that corporation is not in a formalized group — a lone corporation
 * has no group sheet, and showing it one made of itself would be noise.
 */
export async function loadGroupBalanceSheet(
  db: Db,
  corporationId: ObjectId
): Promise<GroupBalanceSheet | null> {
  const membership = await resolveFormalizedGroups(db);
  const rootId = membership.rootByCorpId.get(corporationId.toString());
  if (!rootId) return null;
  const memberIds = membership.membersByRootId.get(rootId);
  if (!memberIds || memberIds.length < 2) return null;

  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: memberIds.map((id) => new ObjectId(id)) } })
    .project<
      Pick<
        Corporation,
        "_id" | "name" | "tickerSymbol" | "countryId" | "liquidCapital" | "liquidCurrencyCode"
      >
    >({ name: 1, tickerSymbol: 1, countryId: 1, liquidCapital: 1, liquidCurrencyCode: 1 })
    .toArray();
  if (corps.length === 0) return null;

  const [sectors, fxByCurrency] = await Promise.all([
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: { $in: corps.map((c) => c._id) } })
      .project<Pick<CorporateSector, "corporationId" | "sectorType" | "stateId" | "revenue">>({
        corporationId: 1,
        sectorType: 1,
        stateId: 1,
        revenue: 1,
      })
      .toArray(),
    loadFxRatesByCurrency(db),
  ]);

  const revenueByCorp = new Map<string, number>();
  const sectorCountByCorp = new Map<string, number>();
  const industries = new Set<CorporationType>();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  for (const sector of sectors) {
    const key = sector.corporationId.toString();
    const owner = corpById.get(key);
    if (!owner) continue;
    // Sector revenue is stored in the HOST country's currency, not the owner's.
    const hostCode = resolveSectorHostCurrencyCode({ countryId: owner.countryId }, null);
    const hostRate = fxRateForSectorHostFromMap({ countryId: owner.countryId }, null, fxByCurrency);
    const anchor = readCorpEconomicAnchor(sector.revenue ?? 0, hostCode, hostRate);
    revenueByCorp.set(key, (revenueByCorp.get(key) ?? 0) + anchor);
    sectorCountByCorp.set(key, (sectorCountByCorp.get(key) ?? 0) + 1);
    industries.add(sector.sectorType);
  }

  const members: GroupMemberSummary[] = corps.map((corp) => {
    const key = corp._id.toString();
    const fxRate = fxRateForCorpFromMap(corp as Corporation, fxByCurrency);
    return {
      corporationId: key,
      name: corp.name,
      ...(corp.tickerSymbol ? { tickerSymbol: corp.tickerSymbol } : {}),
      countryId: corp.countryId,
      isRoot: key === rootId,
      liquidCapitalAnchor: Math.round(
        corpLiquidCapitalToAnchor(corp.liquidCapital ?? 0, corp as Corporation, fxRate)
      ),
      revenueAnchor: Math.round(revenueByCorp.get(key) ?? 0),
      sectorCount: sectorCountByCorp.get(key) ?? 0,
    };
  });

  // Root first, then largest by revenue: the list should read as a structure,
  // not as whatever order the database returned.
  members.sort((a, b) => {
    if (a.isRoot !== b.isRoot) return a.isRoot ? -1 : 1;
    return b.revenueAnchor - a.revenueAnchor;
  });

  const root = corpById.get(rootId);
  return {
    rootCorporationId: rootId,
    rootName: root?.name ?? members[0]?.name ?? "Group",
    memberCount: members.length,
    members,
    totalLiquidCapitalAnchor: members.reduce((sum, m) => sum + m.liquidCapitalAnchor, 0),
    totalRevenueAnchor: members.reduce((sum, m) => sum + m.revenueAnchor, 0),
    totalSectorCount: members.reduce((sum, m) => sum + m.sectorCount, 0),
    industries: [...industries].sort(),
    countries: [...new Set(members.map((m) => m.countryId))].sort(),
  };
}
