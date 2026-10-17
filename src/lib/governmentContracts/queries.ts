/** Country contract boards paginate ten public tenders; sealed bid values are projected out until closing. */
import { ObjectId, type Db, type Filter } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { managementAuthority } from "./authority";
import type { Corporation } from "@/lib/db/types";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { getGameState } from "@/lib/gameState";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";
import { defenceContractLotCaps } from "@/lib/military/defenceContractLimits";
import { tenderAwardInterest } from "./selfDealing";
import {
  CONTRACTS_PAGE_SIZE,
  tenderTab,
  visibleBids,
  visibleBidHistory,
  compareBids,
} from "./rules";
import { tenders } from "./persistence";
import { contractCurrencyQuotes, contractCapacityQuotes } from "./presentation";
import { viewerTenderIds } from "./viewerOpportunities";
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
  const presentation =
    t.terms.type === "extraction"
      ? {
          currencyQuote: (
            await contractCurrencyQuotes(
              db,
              t.countryId,
              (await getGameState(db))?.preset ?? DEFAULT_SEED_PRESET
            )
          ).government,
          capacityQuote: (await contractCapacityQuotes(db, t.countryId, [t])).get(t._id) ?? null,
        }
      : {};
  const ownedCorporationIds = new Set<string>();
  if (user && ObjectId.isValid(user.userId)) {
    const owned = await db
      .collection("corporations")
      .find(
        { userId: new ObjectId(user.userId), ceoVacant: { $ne: true } },
        { projection: { _id: 1 } }
      )
      .toArray();
    for (const corporation of owned) ownedCorporationIds.add(corporation._id.toHexString());
  }
  const canManage =
    !!user && !!(await managementAuthority(db, t.countryId, t.terms, user, t.issuerLevel));
  const awardWarnings: NonNullable<TenderView["awardWarnings"]> = {};
  if (canManage && user && t.status === "open" && tenderTab(t, turn) === "closed") {
    const ids = Object.values(t.bids ?? {})
      .filter((b) => !b.withdrawn)
      .map((b) => new ObjectId(b.corporationId));
    const corporations = ids.length
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: ids } },
            { projection: { userId: 1, shareholders: 1, totalShares: 1 } }
          )
          .toArray()
      : [];
    let tranche = 0;
    if (t.terms.type === "defence" && corporations.length) {
      const game = await getGameState(db);
      const budget = await ensureFederalBudget(
        db,
        t.countryId,
        game?.preset ?? DEFAULT_SEED_PRESET
      );
      tranche = defenceContractLotCaps(resolveDefenseLineFrom(budget), 1).procurementNotional;
    }
    for (const corp of corporations) {
      const id = corp._id.toHexString();
      const interest = tenderAwardInterest(t, corp, user, t.bids[id].amount, tranche);
      if (interest)
        awardWarnings[id] = {
          basis: interest.basis,
          stakeShare: interest.stakeShare,
          favorabilityPenalty: interest.favorabilityPenalty,
        };
    }
  }
  const publicInterest = t.preparedDefence?.selfDealing ?? t.awardSelfDealing;
  const {
    bids,
    bidHistory,
    awardSelfDealing: _awardInterest,
    preparedDefence: _prepared,
    preparedDefenseLine: _defenseLine,
    preparedStateOwned: _stateOwned,
    updatedAt: _updated,
    publishedBy: _publisher,
    awardAttemptId: _attempt,
    awardLeaseKey: _lease,
    awardLeaseRevision: _leaseRevision,
    awardLeaseUntil: _leaseUntil,
    ...rest
  } = t;
  return {
    ...rest,
    ...presentation,
    tab: tenderTab(t, turn),
    bidCount: Object.values(bids ?? {}).filter((b) => !b.withdrawn).length,
    bids: visibleBids({ ...t, bids: bids ?? {} }, turn, user?.userId, ownedCorporationIds)
      .sort((a, b) => compareBids(t.terms.type, a, b))
      .map(({ userId: _userId, ...bid }) => bid),
    bidHistory: visibleBidHistory(
      bidHistory ?? [],
      t.closesTurn,
      turn,
      user?.userId,
      ownedCorporationIds
    ).map(({ userId: _userId, ...bid }) => bid),
    ...(t.status === "awarded" && publicInterest
      ? {
          selfDealing: {
            ministerName: publicInterest.ministerName,
            favorabilityPenalty: publicInterest.favorabilityPenalty,
          },
        }
      : {}),
    canManage,
    ...(canManage ? { awardWarnings } : {}),
  };
}
export async function listGovernmentTenders(
  db: Db,
  countryId: string,
  tab: TenderTab,
  type: ContractType | undefined,
  page: number,
  turn: number,
  viewer?: { userId: string; corporationId?: string }
) {
  const filter = boardFilter(countryId, tab, turn, type);
  if (viewer) {
    const candidates = await tenders(db)
      .find(filter, { projection: { _id: 1, terms: 1, publishedTurn: 1 } })
      .toArray();
    filter._id = {
      $in: await viewerTenderIds(
        db,
        countryId as GovernmentTender["countryId"],
        candidates,
        turn,
        viewer.userId,
        viewer.corporationId
      ),
    };
  }
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
          awardLeaseRevision: 0,
          awardLeaseUntil: 0,
        },
      })
      .sort({ publishedTurn: -1, _id: -1 })
      .skip((page - 1) * CONTRACTS_PAGE_SIZE)
      .limit(CONTRACTS_PAGE_SIZE)
      .toArray(),
  ]);
  const capacity = await contractCapacityQuotes(db, countryId, rows);
  const currencyQuote = rows.some((r) => r.terms.type === "extraction")
    ? (
        await contractCurrencyQuotes(
          db,
          countryId as GovernmentTender["countryId"],
          (await getGameState(db))?.preset ?? DEFAULT_SEED_PRESET
        )
      ).government
    : null;
  return {
    total,
    page,
    pageSize: CONTRACTS_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / CONTRACTS_PAGE_SIZE)),
    tenders: rows.map(({ publishedBy: _publisher, updatedAt: _updated, ...t }) => ({
      ...t,
      ...(t.terms.type === "extraction"
        ? { currencyQuote, capacityQuote: capacity.get(t._id) ?? null }
        : {}),
      tab: tenderTab(t, turn),
    })),
    currentTurn: turn,
  };
}
