import { ObjectId, type Db, type Filter } from "mongodb";
import type { Bill, Corporation, Tariff } from "@/lib/db/types";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { TariffScopeType } from "@/lib/db/types/tariff";
import type { CountryId } from "@/lib/constants/countries";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { resolveLegislatedEmbargoes } from "@/lib/trade/reconcileEmbargoes";
import { NATIONAL_TERMINAL_STATUSES } from "@/lib/congress/billProposalLimits";

export const PUBLIC_TARIFF_SCOPES = [
  "economy_wide",
  "sector",
  "origin_country",
  "corporation",
] as const satisfies readonly TariffScopeType[];

export async function queryTariffs(
  db: Db,
  params: {
    country?: CountryId;
    targetCountry?: CountryId;
    scope?: TariffScopeType;
    limit?: number;
  } = {}
) {
  const filter: Filter<Tariff> = { rate: { $gt: 0 } };
  if (params.country) filter.countryId = params.country;
  if (params.targetCountry) filter.targetOriginCountryId = params.targetCountry;
  if (params.scope) filter.scopeType = params.scope;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
  const tariffs = await db
    .collection<Tariff>("tariffs")
    .find(filter)
    .sort({ countryId: 1, scopeType: 1, createdAt: 1 })
    .limit(limit)
    .toArray();

  const corporationIds = [
    ...new Set(
      tariffs
        .map((tariff) => tariff.targetCorporationId?.toString())
        .filter((id): id is string => id != null)
    ),
  ];
  const corporations = corporationIds.length
    ? await db
        .collection<Corporation>("corporations")
        .find(
          { _id: { $in: corporationIds.map((id) => new ObjectId(id)) } },
          { projection: { name: 1, sequentialId: 1 } }
        )
        .toArray()
    : [];
  const corporationsById = new Map(
    corporations.map((corporation) => [corporation._id.toString(), corporation])
  );

  return {
    found: tariffs.length > 0,
    count: tariffs.length,
    tariffs: tariffs.map((tariff) => {
      const corporation = tariff.targetCorporationId
        ? corporationsById.get(tariff.targetCorporationId.toString())
        : null;
      return {
        id: tariff._id.toString(),
        countryId: tariff.countryId,
        scopeType: tariff.scopeType,
        targetSectorType: tariff.targetSectorType ?? null,
        targetOriginCountryId: tariff.targetOriginCountryId ?? null,
        targetCorporation: corporation
          ? { id: corporation.sequentialId, name: corporation.name }
          : null,
        rate: tariff.rate,
        sourceBillId: tariff.sourceBillId.toString(),
        createdAt: tariff.createdAt.toISOString(),
        updatedAt: tariff.updatedAt.toISOString(),
      };
    }),
  };
}

export async function queryTradeEmbargoes(
  db: Db,
  params: { country?: CountryId; includePending?: boolean } = {}
) {
  const currentTurn = await getCurrentTurn(db);
  const countryFilter = params.country
    ? [{ $or: [{ sourceCountry: params.country }, { targetCountry: params.country }] }]
    : [];
  const stored = await db
    .collection<TradeEmbargo>("tradeEmbargoes")
    .find({
      origin: { $in: ["minister", "organization"] },
      $and: [
        { $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: currentTurn } }] },
        ...countryFilter,
      ],
    } as Filter<TradeEmbargo>)
    .toArray();

  const signedBills = await db
    .collection<Bill>("bills")
    .find(
      {
        status: "signed",
        provisions: { $elemMatch: { type: { $in: ["embargo", "end_embargo"] } } },
      },
      { projection: { _id: 1, countryId: 1, provisions: 1 } }
    )
    .toArray();
  const legislated = resolveLegislatedEmbargoes(signedBills, currentTurn).filter(
    (embargo) =>
      !params.country ||
      embargo.sourceCountry === params.country ||
      embargo.targetCountry === params.country
  );

  const pending = params.includePending ? await queryPendingEmbargoBills(db, params.country) : [];

  return {
    found: stored.length + legislated.length > 0,
    currentTurn,
    embargoes: [
      ...stored.map((embargo) => ({
        id: embargo._id.toString(),
        sourceCountry: embargo.sourceCountry,
        targetCountry: embargo.targetCountry,
        commodity: embargo.commodity,
        direction: embargo.direction,
        mode: embargo.mode,
        cap: embargo.cap ?? null,
        origin: embargo.origin,
        createdTurn: embargo.createdTurn,
        expiresTurn: embargo.expiresTurn ?? null,
        sourceBillId: embargo.sourceBillId?.toString() ?? null,
        sourceResolutionId: embargo.sourceResolutionId?.toString() ?? null,
      })),
      ...legislated.map((embargo) => ({
        id: `leg:${embargo.sourceBillId?.toString() ?? "unknown"}:${embargo.targetCountry}:${embargo.commodity}:${embargo.direction}`,
        sourceCountry: embargo.sourceCountry,
        targetCountry: embargo.targetCountry,
        commodity: embargo.commodity,
        direction: embargo.direction,
        mode: embargo.mode,
        cap: embargo.cap ?? null,
        origin: embargo.origin,
        createdTurn: embargo.createdTurn,
        expiresTurn: null,
        sourceBillId: embargo.sourceBillId?.toString() ?? null,
        sourceResolutionId: null,
      })),
    ],
    pending,
  };
}

async function queryPendingEmbargoBills(db: Db, country?: CountryId) {
  const bills = await db
    .collection<Bill>("bills")
    .find(
      {
        status: { $nin: NATIONAL_TERMINAL_STATUSES },
        provisions: { $elemMatch: { type: { $in: ["embargo", "end_embargo"] } } },
      },
      { projection: { _id: 1, title: 1, status: 1, countryId: 1, provisions: 1 } }
    )
    .toArray();

  return bills.flatMap((bill) => {
    if (!bill.countryId) return [];
    return (bill.provisions ?? []).flatMap((provision) => {
      if (provision.type !== "embargo" && provision.type !== "end_embargo") return [];
      if (country && bill.countryId !== country && provision.targetCountry !== country) {
        return [];
      }
      return [
        {
          billId: bill._id.toString(),
          billTitle: bill.title,
          status: bill.status,
          action: provision.type,
          sourceCountry: bill.countryId,
          targetCountry: provision.targetCountry,
          commodity: provision.commodity,
          direction: provision.direction,
          mode: provision.type === "embargo" ? provision.mode : null,
          cap: provision.type === "embargo" ? (provision.cap ?? null) : null,
        },
      ];
    });
  });
}
