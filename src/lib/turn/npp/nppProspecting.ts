/**
 * NPP extraction prospecting (prospectingEnabled).
 *
 * Player extraction CEOs launch geological surveys; NPP miners never did, so
 * 1953 extractables stay short while idle deposits sit unsurveyed. Cash-rich
 * private NPP miners on a stagger slot launch one survey per turn against the
 * resource their strategy actually produces in that state, through the same
 * `launchCorpProspect` command a player uses (cost, cap, ledger).
 */

import type { Db } from "mongodb";
import type { Corporation, CorporateSector, ExchangeRate, GameConfig } from "@/lib/db/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { getExtractionStrategyResources } from "@/lib/corporations/extractionStrategyAvailability";
import { launchCorpProspect } from "@/lib/extraction/commands/launchCorpProspect";
import { getStateResourceCapacityCollection } from "@/lib/db/collections/stateResourceCapacity";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { glutStaggerEligible } from "@/lib/turn/npp/cohort";
import { prospectCostAnchor } from "@/lib/constants/prospecting";
import {
  anchorToCorpCapital,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

/** Price ratio at or above this: the resource is short enough to survey. */
export const NPP_PROSPECT_SHORTAGE_RATIO = 1.15;
/** Never spend a survey that would drop the corp through this share of cash. */
export const NPP_PROSPECT_CASH_SHARE = 0.25;

export type NppProspectPick = {
  corpId: string;
  stateId: string;
  resource: ExtractableResource;
};

export function pickNppProspect(args: {
  corpId: string;
  cashLocal: number;
  fxRate: number;
  currencyCode: string | undefined;
  sectors: Array<{
    sectorType: string;
    stateId: string;
    countryId?: string | null;
    mothballed?: boolean | null;
    strategyId?: string | null;
  }>;
  priceRatioOf: (resource: ExtractableResource) => number | null;
  priorSuccessCountOf: (stateId: string, resource: ExtractableResource) => number;
  hasDeposit: (
    stateId: string,
    resource: ExtractableResource,
    countryId?: string | null
  ) => boolean;
}): NppProspectPick | null {
  if (!(args.cashLocal > 0)) return null;
  type Candidate = {
    stateId: string;
    resource: ExtractableResource;
    score: number;
    costLocal: number;
  };
  let best: Candidate | null = null;
  for (const s of args.sectors) {
    if (s.sectorType !== "extraction") continue;
    if (s.mothballed === true) continue;
    const strategy =
      SECTOR_STRATEGIES.extraction.find((st) => st.id === (s.strategyId ?? "standard")) ??
      SECTOR_STRATEGIES.extraction[0];
    const resources = getExtractionStrategyResources(strategy);
    const list = resources.length > 0 ? resources : [...EXTRACTABLE_RESOURCES];
    for (const resource of list) {
      if (!args.hasDeposit(s.stateId, resource, s.countryId)) continue;
      const ratio = args.priceRatioOf(resource);
      if (ratio == null || ratio < NPP_PROSPECT_SHORTAGE_RATIO) continue;
      const costAnchor = prospectCostAnchor(args.priorSuccessCountOf(s.stateId, resource));
      const costLocal = args.currencyCode
        ? anchorToCorpCapital(costAnchor, args.currencyCode, args.fxRate)
        : costAnchor;
      if (costLocal > args.cashLocal * NPP_PROSPECT_CASH_SHARE) continue;
      if (args.cashLocal - costLocal <= 0) continue;
      const score = ratio;
      if (!best || score > best.score) {
        best = { stateId: s.stateId, resource, score, costLocal };
      }
    }
  }
  if (!best) return null;
  return { corpId: args.corpId, stateId: best.stateId, resource: best.resource };
}

export async function processNppProspecting(db: Db, turn: number, now: Date): Promise<number> {
  const cfg = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { prospectingEnabled: 1 } });
  if (cfg?.prospectingEnabled !== true) return 0;

  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", type: "extraction", suspended: { $ne: true } })
    .toArray();
  if (nppCorps.length === 0) return 0;

  const corpIds = nppCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: corpIds }, sectorType: "extraction" },
      {
        projection: {
          corporationId: 1,
          stateId: 1,
          countryId: 1,
          sectorType: 1,
          mothballed: 1,
          strategyId: 1,
        },
      }
    )
    .toArray();
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const key = s.corporationId.toString();
    const list = sectorsByCorp.get(key) ?? [];
    list.push(s);
    sectorsByCorp.set(key, list);
  }

  const priceDocs = await db.collection<CommodityPrice>("commodityPrices").find({}).toArray();
  const priceByCommodity = new Map<string, CommodityPrice>();
  for (const doc of priceDocs) {
    const existing = priceByCommodity.get(doc.commodity);
    if (!existing || (doc.turn ?? 0) >= (existing.turn ?? 0)) {
      priceByCommodity.set(doc.commodity, doc);
    }
  }

  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }

  const surveys = await db
    .collection<{ stateId: string; resource: ExtractableResource; status: string }>(
      "prospectingSurveys"
    )
    .find({ status: "succeeded" }, { projection: { stateId: 1, resource: 1 } })
    .toArray();
  const successCounts = new Map<string, number>();
  for (const s of surveys) {
    const key = `${s.stateId}:${s.resource}`;
    successCounts.set(key, (successCounts.get(key) ?? 0) + 1);
  }

  const stateIds = [...new Set(sectors.map((s) => s.stateId))];
  const capCol = await getStateResourceCapacityCollection(db);
  const capDocs =
    stateIds.length > 0
      ? await capCol
          .find(
            { stateId: { $in: stateIds } },
            { projection: { stateId: 1, countryId: 1, resources: 1 } }
          )
          .toArray()
      : [];
  const depositKeys = new Set<string>();
  for (const cap of capDocs) {
    for (const [resource, amount] of Object.entries(cap.resources ?? {})) {
      if (typeof amount === "number" && amount > 0) {
        depositKeys.add(`${cap.countryId}:${cap.stateId}:${resource}`);
      }
    }
  }

  let launched = 0;
  for (const corp of nppCorps) {
    if (isStateOwned(corp)) continue;
    if (!glutStaggerEligible(corp._id.toString(), turn)) continue;
    const corpSectors = sectorsByCorp.get(corp._id.toString()) ?? [];
    const currencyCode = resolveCorpLiquidCurrencyCode(corp);
    const fxRate = (currencyCode && fxByCurrency.get(currencyCode)) || 1;
    const pick = pickNppProspect({
      corpId: corp._id.toString(),
      cashLocal: corp.liquidCapital ?? 0,
      fxRate,
      currencyCode,
      sectors: corpSectors,
      priceRatioOf: (resource) => {
        const doc = priceByCommodity.get(resource);
        if (!doc?.basePrice) return null;
        const price = doc.nationalPrices?.[corp.countryId] ?? doc.globalPrice;
        if (!price || !Number.isFinite(price)) return null;
        return price / doc.basePrice;
      },
      priorSuccessCountOf: (stateId, resource) => successCounts.get(`${stateId}:${resource}`) ?? 0,
      hasDeposit: (stateId, resource, countryId) =>
        countryId != null && depositKeys.has(`${countryId}:${stateId}:${resource}`),
    });
    if (!pick) continue;
    const result = await launchCorpProspect(
      db,
      corp,
      { stateId: pick.stateId, resource: pick.resource },
      turn,
      now
    );
    if (result.ok) launched += 1;
  }
  return launched;
}
