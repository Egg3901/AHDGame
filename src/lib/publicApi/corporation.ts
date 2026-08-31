import type { Db, ObjectId } from "mongodb";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import type { Corporation, Character } from "@/lib/db/types";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { Bond } from "@/lib/db/types/bond";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import {
  loadValuationFxRates,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { corpFinancials } from "./corpFinancials";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

export async function queryCorporation(db: Db, params: { name?: string; id?: string }) {
  const { name, id } = params;

  const corp = await db
    .collection<Corporation>("corporations")
    .findOne(
      id
        ? ({ sequentialId: parseInt(id, 10) } as Record<string, unknown>)
        : { name: { $regex: escapeRegex(name ?? ""), $options: "i" } }
    );
  if (!corp) return null;

  // Top 20 holders come from the embedded shareholders array (there is no
  // separate corporationShares collection). Resolve character holder names.
  const topHolders = [...(corp.shareholders ?? [])]
    .sort((a, b) => (b.shares ?? 0) - (a.shares ?? 0))
    .slice(0, 20);
  const holderCharacterIds = topHolders
    .map((h) => h.characterId ?? h.imperialCharacterId)
    .filter((x): x is ObjectId => Boolean(x));
  const holderCorporationIds = topHolders
    .map((h) => h.corporationId)
    .filter((x): x is ObjectId => Boolean(x));

  const [ceo, bonds, sectors, holderChars, holderCorps] = await Promise.all([
    corp.ceoId && !corp.ceoVacant
      ? db
          .collection<Character>("characters")
          .findOne({ _id: corp.ceoId }, { projection: { name: 1 } })
      : Promise.resolve(null),
    db.collection<Bond>("bonds").find({ corporationId: corp._id }).toArray(),
    db.collection<CorporateSector>("corporateSectors").find({ corporationId: corp._id }).toArray(),
    holderCharacterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: holderCharacterIds } }, { projection: { name: 1 } })
          .toArray()
      : Promise.resolve([]),
    holderCorporationIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: holderCorporationIds } }, { projection: { name: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);

  // Resolve state display names for the sector rows.
  const sectorStateIds = [...new Set(sectors.map((s) => s.stateId).filter(Boolean))];
  const states =
    sectorStateIds.length > 0
      ? await db
          .collection<{ _id: string; name?: string }>("states")
          .find({ _id: { $in: sectorStateIds } }, { projection: { name: 1 } })
          .toArray()
      : [];
  const stateNameById = new Map(states.map((s) => [s._id, s.name ?? s._id]));
  const charNameById = new Map(holderChars.map((c) => [c._id.toString(), c.name]));
  const corpNameById = new Map(holderCorps.map((c) => [c._id.toString(), c.name]));

  const totalShares = corp.totalShares ?? 1;

  // Financials are derived from the operational sectors (the corp document does
  // not store revenue/income directly), on the same basis the internal
  // corporation detail view uses: realized revenue, the engine-applied margin,
  // and each sector converted from its HOST currency before summing. See
  // lib/publicApi/corpFinancials.
  //
  // Valuation map, not the settlement map: these figures are DISPLAYED.
  const fxByCurrency = await loadValuationFxRates(db);
  const hostRateBySectorId = new Map<string, number>(
    sectors.map((s) => [String(s._id), fxRateForSectorHostFromMap(s, corp, fxByCurrency)])
  );
  const { totalRevenue, operatingIncome, operatingCosts } = corpFinancials({
    sectors,
    hostRateBySectorId,
  });

  return {
    found: true,
    id: corp._id.toString(),
    sequentialId: corp.sequentialId,
    name: corp.name,
    description: ((corp as Record<string, unknown>).description as string) ?? null,
    type: corp.type,
    typeLabel: ((corp as Record<string, unknown>).typeLabel as string) ?? corp.type,
    brandColor: ((corp as Record<string, unknown>).brandColor as string) ?? null,
    logoUrl: ((corp as Record<string, unknown>).logoUrl as string) ?? null,
    countryId: ((corp as Record<string, unknown>).countryId as string) ?? null,
    headquartersState: ((corp as Record<string, unknown>).headquartersState as string) ?? null,
    corpUrl: `${BASE_URL}/corporations/${corp.sequentialId}`,
    ceo: ceo ? { name: ceo.name, profileUrl: `${BASE_URL}/character/${ceo._id}` } : null,
    financials: {
      totalRevenue: Math.round(totalRevenue),
      operatingIncome: Math.round(operatingIncome),
      operatingCosts: Math.round(operatingCosts),
      dividendRate: corp.dividendRate ?? 0,
    },
    balanceSheet: {
      cashOnHand: corp.liquidCapital ?? 0,
      marketCapitalization: getRoundedPublicMarketCap(corp, totalShares),
      totalDebt: bonds.reduce(
        (s, b) => s + (((b as Record<string, unknown>).totalIssued as number) ?? 0),
        0
      ),
    },
    shareStructure: {
      totalShares: corp.totalShares ?? 0,
      publicFloat: corp.publicFloat ?? 0,
      publicFloatPct:
        totalShares > 0 ? Math.round(((corp.publicFloat ?? 0) / totalShares) * 1000) / 10 : 0,
      sharePrice: corp.sharePrice ?? 0,
      shareholders: topHolders.map((h) => {
        const name =
          (h.characterId && charNameById.get(h.characterId.toString())) ??
          (h.imperialCharacterId && charNameById.get(h.imperialCharacterId.toString())) ??
          (h.corporationId && corpNameById.get(h.corporationId.toString())) ??
          (h.fundId ? "Index Fund" : null) ??
          (h.nppId ? "National Public Party" : null);
        return {
          name: name ?? null,
          shares: h.shares ?? 0,
          percentage: totalShares > 0 ? Math.round(((h.shares ?? 0) / totalShares) * 1000) / 10 : 0,
        };
      }),
    },
    creditRating: {
      rating: corp.creditRatingSnapshot ?? null,
      compositeScore: corp.creditCompositeSnapshot ?? null,
      snapshotTurn: corp.creditSnapshotTurn ?? null,
      components: corp.creditRatingComponents ?? null,
    },
    bonds: (bonds as Array<Record<string, unknown>>).map((b) => ({
      id: (b._id as { toString(): string }).toString(),
      couponRate: (b.couponRate as number) ?? 0,
      maturityLabel: (b.maturityLabel as string) ?? null,
      totalIssued: (b.totalIssued as number) ?? 0,
      marketPrice: (b.marketPrice as number) ?? 0,
      turnsRemaining: (b.turnsRemaining as number) ?? 0,
      yieldToMaturity: (b.yieldToMaturity as number) ?? null,
      holders: Array.isArray(b.holders) ? b.holders.length : 0,
      defaulted: (b.defaulted as boolean) ?? false,
    })),
    sectors: sectors.map((s) => ({
      stateId: s.stateId ?? null,
      stateName: stateNameById.get(s.stateId) ?? s.stateId ?? null,
      sectorType: s.sectorType ?? null,
      revenue: s.revenue ?? 0,
      profitMargin: s.profitMargin ?? 0,
      currentGrowthRate: s.currentGrowthRate ?? s.growthRate ?? 0,
      workers: s.workers ?? 0,
    })),
  };
}

export async function queryCorporationList(db: Db) {
  const corps = await db
    .collection<Corporation>("corporations")
    .find({})
    .project<{
      _id: unknown;
      name: string;
      sequentialId: number;
      type: string;
      countryId: string;
    }>({
      _id: 1,
      name: 1,
      sequentialId: 1,
      type: 1,
      countryId: 1,
    })
    .sort({ sequentialId: 1 })
    .toArray();

  return corps.map((c) => ({
    id: (c._id as { toString(): string }).toString(),
    name: c.name,
    sequentialId: c.sequentialId,
    type: c.type,
    countryId: c.countryId,
  }));
}

/**
 * Public share-trade tape for one corporation (same data the in-game corp page
 * serves at /api/corporations/[id]/shares/history), resolved by sequentialId or
 * name to match queryCorporation's addressing. Newest first, paginated.
 */
export async function queryShareHistory(
  db: Db,
  params: { name?: string; id?: string; page?: number; pageSize?: number }
) {
  const { name, id } = params;
  const page = Math.max(params.page ?? 1, 1);
  const pageSize = Math.min(Math.max(params.pageSize ?? 50, 1), 200);

  const corp = await db
    .collection<Corporation>("corporations")
    .findOne(
      id
        ? ({ sequentialId: parseInt(id, 10) } as Record<string, unknown>)
        : { name: { $regex: escapeRegex(name ?? ""), $options: "i" } }
    );
  if (!corp) return null;

  const filter = { corporationId: corp._id };
  const [total, entries] = await Promise.all([
    db.collection<ShareTradeHistory>("shareTradeHistory").countDocuments(filter),
    db
      .collection<ShareTradeHistory>("shareTradeHistory")
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
  ]);

  return {
    found: true,
    corporation: { id: corp.sequentialId ?? corp._id.toString(), name: corp.name },
    page,
    pageSize,
    total,
    pageCount: total === 0 ? 1 : Math.ceil(total / pageSize),
    entries: entries.map((e) => ({
      id: e._id.toString(),
      kind: e.kind,
      turn: e.turn,
      createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : (e.createdAt ?? null),
      shares: e.shares,
      pricePerShareAnchor: e.pricePerShareAnchor,
      totalAnchor: e.totalAnchor,
      corpCurrencyCode: e.corpCurrencyCode ?? null,
      from: e.from ? { name: e.from.name } : null,
      to: e.to ? { name: e.to.name } : null,
      note: e.note ?? null,
    })),
  };
}
