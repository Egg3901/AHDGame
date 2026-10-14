/** Country contract boards paginate ten public tenders; sealed bid values are projected out until closing. */
import type { Db, Filter } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { managementAuthority } from "./authority";
import {
  CONTRACTS_PAGE_SIZE,
  tenderTab,
  visibleBids,
  visibleBidHistory,
  compareBids,
} from "./rules";
import { tenders } from "./persistence";
import type { GovernmentTender, TenderTab, ContractType, TenderView } from "./types";

export function boardFilter(
  countryId: string,
  tab: TenderTab,
  turn: number,
  type?: ContractType
): Filter<GovernmentTender> {
  const common = { countryId, ...(type ? { "terms.type": type } : {}) };
  if (tab === "awarded") return { ...common, status: "awarded" } as Filter<GovernmentTender>;
  if (tab === "canceled")
    return {
      ...common,
      $or: [{ status: "canceled" }, { status: "open", awardDeadlineTurn: { $lte: turn } }],
    } as Filter<GovernmentTender>;
  if (tab === "active")
    return {
      ...common,
      status: "open",
      closesTurn: { $gt: turn },
      awardDeadlineTurn: { $gt: turn },
    } as Filter<GovernmentTender>;
  return {
    ...common,
    $or: [
      { status: "awarding" },
      { status: "open", closesTurn: { $lte: turn }, awardDeadlineTurn: { $gt: turn } },
    ],
  } as Filter<GovernmentTender>;
}
export async function tenderView(
  db: Db,
  t: GovernmentTender,
  turn: number,
  user?: AuthUserWithCharacter | null
): Promise<TenderView> {
  const {
    bids,
    bidHistory,
    awardSelfDealing: _awardInterest,
    updatedAt: _updated,
    publishedBy: _publisher,
    awardAttemptId: _attempt,
    awardLeaseKey: _lease,
    awardLeaseUntil: _leaseUntil,
    ...rest
  } = t;
  return {
    ...rest,
    tab: tenderTab(t, turn),
    bidCount: Object.values(bids ?? {}).filter((b) => !b.withdrawn).length,
    bids: visibleBids({ ...t, bids: bids ?? {} }, turn, user?.userId)
      .sort((a, b) => compareBids(t.terms.type, a, b))
      .map(({ userId: _userId, ...bid }) => bid),
    bidHistory: visibleBidHistory(bidHistory ?? [], t.closesTurn, turn, user?.userId).map(
      ({ userId: _userId, ...bid }) => bid
    ),
    canManage:
      !!user && !!(await managementAuthority(db, t.countryId, t.terms, user, t.issuerLevel)),
  };
}
export async function listGovernmentTenders(
  db: Db,
  countryId: string,
  tab: TenderTab,
  type: ContractType | undefined,
  page: number,
  turn: number
) {
  const filter = boardFilter(countryId, tab, turn, type);
  const [total, rows] = await Promise.all([
    tenders(db).countDocuments(filter),
    tenders(db)
      .find(filter, {
        projection: {
          bids: 0,
          bidHistory: 0,
          awardSelfDealing: 0,
          preparedDefence: 0,
          preparedDefenseLine: 0,
          preparedStateOwned: 0,
          awardAttemptId: 0,
          awardLeaseKey: 0,
          awardLeaseUntil: 0,
        },
      })
      .sort({ publishedTurn: -1, _id: -1 })
      .skip((page - 1) * CONTRACTS_PAGE_SIZE)
      .limit(CONTRACTS_PAGE_SIZE)
      .toArray(),
  ]);
  return {
    total,
    page,
    pageSize: CONTRACTS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / CONTRACTS_PAGE_SIZE)),
    tenders: rows.map(({ publishedBy: _publisher, updatedAt: _updated, ...t }) => ({
      ...t,
      tab: tenderTab(t, turn),
    })),
    currentTurn: turn,
  };
}
