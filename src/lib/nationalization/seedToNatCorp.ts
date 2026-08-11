import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import { resolveNationalCorporationForSector } from "./nationalCorporation";
import { writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import type { ExchangeRate } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { computeSectorImpliedUnits } from "@/lib/market/unownedHeadroom";
import {
  mergeSectorPlantFields,
  readSectorPlantFields,
} from "@/lib/corporations/sectorTransferCapex";

const DEFAULT_PROFIT_MARGIN = 20;
const DEFAULT_GROWTH_RATE = 1;

/**
 * Load FX rate for a country's currency. Used by {@link incrementNatCorpSectorRevenue}
 * to convert ₳-denominated seed revenue into the natcorp's local currency before
 * persisting — corporateSectors.revenue is stored in liquidCurrencyCode units.
 */
async function loadFxRateForCountry(
  db: Db,
  countryId: CountryId
): Promise<{ code: CurrencyCode | undefined; rate: number }> {
  const code = COUNTRY_CURRENCY_MAP[countryId];
  if (!code) return { code: undefined, rate: 1 };
  const doc = await db.collection<ExchangeRate>("exchangeRates").findOne({ currencyCode: code });
  return { code, rate: doc?.rate && doc.rate > 0 ? doc.rate : 1 };
}

/**
 * Add revenue directly to a National Corporation sector (admin seed / heal path).
 * No nationalization haircut — this is fresh capacity, not a disrupted transfer.
 */
export async function incrementNatCorpSectorRevenue(
  db: Db,
  params: {
    countryId: CountryId;
    stateId: string;
    sectorType: CorporationType;
    revenueDelta: number;
  }
): Promise<"inc" | "insert" | "noop"> {
  const revenueDeltaAnchor = Math.round(params.revenueDelta);
  if (revenueDeltaAnchor <= 0) return "noop";

  const now = new Date();
  const corp = await resolveNationalCorporationForSector(db, params.countryId, params.sectorType);

  // Convert ₳-denominated seed revenue into the natcorp's local currency before
  // persisting. corporateSectors.revenue is stored in liquidCurrencyCode units;
  // the commodity turn reads it back via readCorpEconomicAnchor (local → ₳).
  // Without this conversion, a ₳ amount stored into a GBP corp gets divided by
  // the GBP FX rate again on read, double-converting and inflating by ~1.5x.
  const { code, rate } = await loadFxRateForCountry(db, params.countryId);
  const corpCode = resolveCorpLiquidCurrencyCode(corp) ?? code;
  const corpRate = corpCode === code ? rate : 1;
  const revenueDeltaLocal = Math.round(
    writeCorpEconomicLocal(revenueDeltaAnchor, corpCode, corpRate)
  );

  // PLANTS LOCKSTEP. Under `marketSystemMode >= "plants"` a corporate sector's
  // `revenue` is DERIVED — `sectorTurn` restates it from `capitalStock × mix
  // price` every turn — so a revenue-only seed is erased on the next tick and
  // the natcorp receives nothing. The quantity therefore has to land on
  // capacity. `computeSectorImpliedUnits` is the same ₳ → units conversion the
  // engine's `impliedOutputUnits` and the unowned headroom derivation use, so
  // the units are commensurable with `capitalStock`. It takes ₳, NOT the
  // local-currency figure — `capitalStock` is currency-free.
  //
  // Revenue is still written, in LOCKSTEP and off the same quantity: units
  // lead, revenue is the derived restatement of those same units, so the two
  // legs cannot diverge and the first turn's figure matches what `sectorTurn`
  // recomputes. `plantsStartTurn` is deliberately left unset — `sectorTurn`
  // stamps it on the sector's first plants turn, which starts the launch
  // governor's ramp for genuinely new capacity.
  //
  // Below plants `capacityUnitsDelta` is 0 and every write here is byte
  // identical to the pre-P3b behaviour.
  // PLANTS-GATED: under plants the seed grants `capitalStock` units converted from
  // the same ₳ figure as the revenue leg, so units lead and revenue is the derived
  // restatement of that same quantity. Below plants the capacity delta is 0 and
  // every write is byte-identical to the pre-P3b behaviour.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  // Dynamic import: budgets.ts reaches this module through seedUnownedSectors,
  // and a static gdpAnchorRate import would close the same init cycle
  // publicEnterpriseRevenue documents (gdpAnchorRate → countryReadinessContract
  // → budgets → … → here).
  const capacityUnitsDelta = plantsEnabled
    ? computeSectorImpliedUnits(
        params.sectorType,
        revenueDeltaAnchor,
        null,
        await (await import("@/lib/currency/gdpAnchorRate")).loadWorldEraUnitScale(db)
      )
    : 0;

  const sectors = db.collection<CorporateSector>("corporateSectors");
  const existing = await sectors.findOne({
    corporationId: corp._id,
    stateId: params.stateId,
    sectorType: params.sectorType,
  });

  if (existing) {
    await sectors.updateOne(
      { _id: existing._id },
      {
        $inc: {
          revenue: revenueDeltaLocal,
          ...(capacityUnitsDelta > 0 ? { capitalStock: capacityUnitsDelta } : {}),
        },
        $set: { updatedAt: now },
      }
    );
    return "inc";
  }

  await sectors.insertOne({
    _id: new ObjectId(),
    corporationId: corp._id,
    countryId: params.countryId,
    stateId: params.stateId,
    sectorType: params.sectorType,
    revenue: revenueDeltaLocal,
    ...(capacityUnitsDelta > 0 ? { capitalStock: capacityUnitsDelta } : {}),
    workers: 0,
    profitMargin: DEFAULT_PROFIT_MARGIN,
    targetGrowthRate: DEFAULT_GROWTH_RATE,
    currentGrowthRate: DEFAULT_GROWTH_RATE,
    currentGrowthCost: 0,
    createdAt: now,
    updatedAt: now,
  } as CorporateSector);
  return "insert";
}

/** Move an unowned doc's revenue into the National Corporation and delete the doc. */
export async function absorbUnownedDocIntoNatCorp(
  db: Db,
  doc: Pick<UnownedSector, "_id" | "stateId" | "sectorType" | "countryId" | "revenue">,
  opts?: { revenueOverride?: number; dryRun?: boolean }
): Promise<number> {
  const revenue = Math.round(opts?.revenueOverride ?? doc.revenue ?? 0);
  if (revenue <= 0) {
    if (!opts?.dryRun) {
      await db.collection<UnownedSector>("unownedSectors").deleteOne({ _id: doc._id });
    }
    return 0;
  }

  if (!opts?.dryRun) {
    await incrementNatCorpSectorRevenue(db, {
      countryId: doc.countryId,
      stateId: doc.stateId,
      sectorType: doc.sectorType as CorporationType,
      revenueDelta: revenue,
    });
    await db.collection<UnownedSector>("unownedSectors").deleteOne({ _id: doc._id });
  }
  return revenue;
}

/** Apply a revenue multiplier by absorbing the boosted amount into the National Corporation. */
export async function boostUnownedDocIntoNatCorp(
  db: Db,
  doc: Pick<UnownedSector, "_id" | "stateId" | "sectorType" | "countryId" | "revenue">,
  multiplier: number
): Promise<number> {
  const boosted = Math.round((doc.revenue ?? 0) * multiplier);
  return absorbUnownedDocIntoNatCorp(db, doc, { revenueOverride: boosted });
}

export type OwnedSectorMergeInput = Pick<
  CorporateSector,
  | "_id"
  | "stateId"
  | "sectorType"
  | "countryId"
  | "revenue"
  | "workers"
  | "currentGrowthCost"
  | "corporationId"
>;

/**
 * Fold a private/NPC sector into the National Corporation (admin heal path).
 * Full revenue is transferred with no nationalization haircut or compensation.
 */
export async function absorbOwnedSectorIntoNatCorp(
  db: Db,
  sector: OwnedSectorMergeInput,
  opts?: { dryRun?: boolean }
): Promise<number> {
  const revenue = Math.round(sector.revenue ?? 0);
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  // PLANT STATE decides whether this row is empty — not `revenue`.
  //
  // Under plants `revenue` is DERIVED from `capitalStock`, and a MOTHBALLED
  // sector reports 0 while holding its whole capital stock and any outstanding
  // CIP / queued build orders. The old `revenue <= 0` branch below deleted such
  // a row outright, so an admin heal quietly incinerated real, paid-for plant
  // and the National Corporation received nothing. The `Pick` this function
  // takes does not carry the plant fields, so they are read from the live doc
  // rather than trusted from the caller's projection.
  //
  // Below plants the lookup is skipped entirely and every path here is
  // byte-identical to the previous behaviour.
  const donorPlant = plantsEnabled
    ? await sectors.findOne(
        { _id: sector._id },
        {
          projection: {
            capitalStock: 1,
            buildQueue: 1,
            constructionInProgressAnchor: 1,
            mothballed: 1,
            plantsStartTurn: 1,
            legacyRevenueShadow: 1,
          },
        }
      )
    : null;
  const donorHasPlant =
    donorPlant != null &&
    (() => {
      const p = readSectorPlantFields(donorPlant);
      return (
        (typeof p.capitalStock === "number" && p.capitalStock > 0) ||
        (typeof p.constructionInProgressAnchor === "number" &&
          p.constructionInProgressAnchor > 0) ||
        (Array.isArray(p.buildQueue) && p.buildQueue.length > 0)
      );
    })();

  if (revenue <= 0 && !donorHasPlant && !opts?.dryRun) {
    await sectors.deleteOne({ _id: sector._id });
    return 0;
  }
  if (opts?.dryRun) return Math.max(0, revenue);

  const now = new Date();
  const corp = await resolveNationalCorporationForSector(
    db,
    sector.countryId,
    sector.sectorType as CorporationType
  );
  const existing = await sectors.findOne({
    corporationId: corp._id,
    stateId: sector.stateId,
    sectorType: sector.sectorType,
  });

  if (existing && !existing._id.equals(sector._id)) {
    // MERGE — the donor row is DELETED immediately below, so anything not
    // folded into the survivor here is destroyed. The revenue/worker/growth
    // legs were folded; the PLANT state was not, so under plants every merged
    // heal silently burned the donor's capacity and the ₳ sitting in its CIP.
    // `mergeSectorPlantFields` sums capacity and CIP, concatenates the queues in
    // landing order, ANDs `mothballed` and keeps the EARLIER ramp anchor —
    // the same fold `ownershipTransition` and `repairDuplicateSectors` use.
    const merged =
      plantsEnabled && donorPlant
        ? mergeSectorPlantFields(readSectorPlantFields(existing), readSectorPlantFields(donorPlant))
        : null;
    await sectors.updateOne(
      { _id: existing._id },
      {
        $inc: {
          revenue,
          workers: sector.workers ?? 0,
          currentGrowthCost: sector.currentGrowthCost ?? 0,
        },
        $set: {
          ...(merged
            ? {
                ...merged,
                constructionInProgressAnchor: Math.round(merged.constructionInProgressAnchor),
              }
            : {}),
          updatedAt: now,
        },
      }
    );
    await sectors.deleteOne({ _id: sector._id });
  } else {
    await sectors.updateOne(
      { _id: sector._id },
      { $set: { corporationId: corp._id, updatedAt: now } }
    );
  }
  return revenue;
}
